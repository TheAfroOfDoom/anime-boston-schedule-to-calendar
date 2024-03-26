import { writeFileSync } from "fs";
import ical, { ICalCalendarMethod } from "ical-generator";
import { JSDOM } from "jsdom";
import normalizeHtmlTable from "@eirikb/normalize-html-table";

const baseUrl = "https://www.animeboston.com";

const parseLocations = (
	buildingRow: HTMLTableRowElement,
	roomRow: HTMLTableRowElement,
) => {
	const columns: string[] = [];

	const SKIP_FLAG = "__skip__";
	for (const building of buildingRow.querySelectorAll("th")) {
		if (building.classList.contains("schedule-filler")) {
			columns.push(SKIP_FLAG);
			continue;
		}

		const { colSpan, textContent } = building;
		if (textContent == null) {
			throw new Error("Building does not have text content");
		}

		for (let i = 0; i < colSpan; i += 1) {
			columns.push(`${textContent.trim()}:`);
		}
	}

	let columnIdx = 1;
	for (const room of roomRow.querySelectorAll("th")) {
		const { textContent } = room;
		if (textContent == null) {
			throw new Error("Room does not have text content");
		}
		columns[columnIdx] = `${columns[columnIdx]} ${textContent.trim()}`;
		columnIdx += 1;
	}

	return columns;
};

/** Returns a new date object */
const addHours = (hourString: string, date: Date): Date => {
	const [hoursString, minutesString, am] = hourString.split(/[: ]/);

	const minutes = Number(minutesString);
	let hours = Number(hoursString);
	if (am.toLowerCase() === "pm") {
		hours += 12;
	} else {
		// If this is an AM time before 8:00 am, its actually the next day
		if (hours < 8) {
			hours += 24;
		}
	}

	const newDate = new Date(date);
	newDate.setHours(hours, Number(minutes), 0, 0);
	return newDate;
};

const parseTimes = (eventRows: HTMLTableRowElement[], date: Date) => {
	const times = eventRows.map((eventRow) => {
		const time = eventRow.querySelector("th.schedule-time")?.textContent;
		if (time == null) {
			throw new Error("Failed to parse time from first column");
		}
		return addHours(time, date);
	});

	// Add extra row at end for `Event.timeEnd` property
	// e.g. if `schedule-table` goes up to 1:45 AM, we add 2:00 AM
	// TODO: this shouldn't be hardcoded probably
	const lastTime = times.at(-1)!.getTime();
	if (lastTime === addHours("1:45 am", date).getTime()) {
		times.push(addHours("2:00 am", date));
	} else if (lastTime === addHours("4:45 pm", date).getTime()) {
		times.push(addHours("5:00 pm", date));
	} else {
		throw new Error(`New final time seen: ${lastTime}`);
	}

	return times;
};

const getEventText = (
	eventElement: HTMLTableCellElement | undefined,
): string | undefined => {
	if (typeof eventElement === "undefined") {
		return void 0;
	}
	return eventElement.getAttribute("title") ?? "";
};

const getEventUrl = (eventElement: HTMLTableCellElement): string => {
	const onclick = eventElement.getAttribute("onclick");
	if (onclick == null) {
		throw new Error("Event didn't have `onclick` attribute");
	}

	// URL is in single-quotes in the onclick string
	const url = onclick.split("'")[1];
	if (!url.includes("/schedule/")) {
		throw new Error(`URL had unexpected format: ${url}`);
	}
	return url;
};

const parseEventEndTime = ({
	eventArray,
	times,
	rowIdx,
	columnIdx,
}: {
	eventArray: HTMLTableCellElement[][];
	times: Date[];
	rowIdx: number;
	columnIdx: number;
}): Date => {
	let endRowIdx = rowIdx;
	const initialEventText = getEventText(eventArray[rowIdx][columnIdx]);
	if (initialEventText == null) {
		throw new Error(`Bad event text at [${rowIdx}][${columnIdx}]`);
	}

	let currentEventText: string | undefined = initialEventText;
	while (currentEventText === initialEventText) {
		endRowIdx += 1;
		currentEventText = getEventText(eventArray[endRowIdx]?.[columnIdx]);
	}
	return times[endRowIdx];
};

type EventPartial = {
	name: string;
	timeStart: Date;
	timeEnd: Date;
	location: string;
	url: string;
};

type Event = EventPartial & {
	description: string;
};

type EventPartialMap = {
	[name: string]: EventPartial;
};

const parseEvents = ({
	locations,
	table,
	times,
}: {
	locations: string[];
	table: HTMLTableElement;
	times: Date[];
}): EventPartialMap => {
	const eventMap: EventPartialMap = {};

	const normalizedTable = normalizeHtmlTable(table);

	// Initial row index of the first event row in the table is 2 (the 3rd row)
	let rowIdx = -1;
	const initialColumnIdx = -1;
	let columnIdx = initialColumnIdx;

	for (const eventRow of normalizedTable) {
		rowIdx += 1;
		for (const eventElement of eventRow) {
			columnIdx += 1;

			const eventString = getEventText(eventElement);

			if (eventString == null) {
				throw new Error("Event string was null");
			}

			const shouldSkipEvent =
				// Blank event string means an empty cell on the schedule table
				eventString === "" ||
				// If eventString is already a key in eventMap, then this indicates a cell
				// that is a continuation from an event we've already parsed
				eventString in eventMap;

			if (shouldSkipEvent) {
				continue;
			}

			const timeEnd = parseEventEndTime({
				eventArray: normalizedTable,
				times,
				rowIdx,
				columnIdx,
			});

			const event: EventPartial = {
				name: eventString,
				timeStart: times[rowIdx],
				timeEnd,
				location: locations[columnIdx + 1],
				url: `${baseUrl}${getEventUrl(eventElement)}`,
			};
			eventMap[eventString] = event;
		}
		columnIdx = initialColumnIdx;
	}

	return eventMap;
};

const exportToICalCalendar = async (events: Event[]): Promise<void> => {
	const path = "./exportedCalendar.ical";
	console.log(`Exporting calendar to '${path}'`);

	const calendar = ical({
		name: "Anime Boston Calendar",
		method: ICalCalendarMethod.PUBLISH,
	});
	for (const event of events) {
		calendar.createEvent({
			start: event.timeStart,
			end: event.timeEnd,
			summary: event.name,
			description: event.description,
			location: event.location,
			url: event.url,
		});
	}

	await writeFileSync(path, calendar.toString(), { flag: "w" });

	console.log("Finished exporting");
};

const main = async () => {
	const scheduleUrl = `${baseUrl}/schedule/index/2024`;
	const response = await fetch(scheduleUrl);
	const text = await response.text();

	const dom = new JSDOM(text, { url: scheduleUrl });
	const { document, HTMLTableElement } = dom.window;

	const scheduleTables = document.querySelectorAll("table.schedule-table");
	const [fridaySchedule, saturdaySchedule, sundaySchedule] = scheduleTables;

	const events: Event[] = [];
	for (const [date, scheduleTable] of [
		// These dates **need** to be at T00:00:00 for this script to export calendar events correctly
		[new Date("2024-03-29Z-04:00"), fridaySchedule],
		[new Date("2024-03-30Z-04:00"), saturdaySchedule],
		[new Date("2024-03-31Z-04:00"), sundaySchedule],
	] as const) {
		// Ignore last 2 rows -- they are duplicates
		const [buildingRow, roomRow, ...eventRows] = Array.from(
			scheduleTable.querySelectorAll("tr"),
		).slice(0, -2);

		const locations = parseLocations(buildingRow, roomRow);

		const times = parseTimes(eventRows, date);

		if (!(scheduleTable instanceof HTMLTableElement)) {
			throw new Error("Schedule table didn't return <table> element");
		}
		const eventPartialMap = parseEvents({
			table: scheduleTable,
			locations,
			times,
		});
		const partialEvents = Object.values(eventPartialMap);
		console.log(
			`Parsed ${partialEvents.length} events from ${date.toDateString()} schedule table`,
		);

		for (const event of partialEvents) {
			console.log(
				`Fetching description for event: '${event.name}' at URL: '${event.url}'`,
			);
			const response = await fetch(event.url);
			const html = await response.text();
			const eventDom = new JSDOM(html);
			const { document } = eventDom.window;
			const description = document.querySelector(
				"div.page-body > p:nth-child(4)",
			)?.textContent;
			if (description == null) {
				throw new Error(`Failed to fetch description for event: ${event.name}`);
			}
			events.push({
				...event,
				description,
			});
		}
	}

	await exportToICalCalendar(events);
};

main();
