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

const parseTimes = (eventRows: HTMLTableRowElement[]) => {
	const times = eventRows.map((eventRow) => {
		const time = eventRow.querySelector("th.schedule-time")?.textContent;
		if (time == null) {
			throw new Error("Failed to parse time from first column");
		}
		return time;
	});

	// Add extra row at end for `Event.timeEnd` property
	// e.g. if `schedule-table` goes up to 1:45 AM, we add 2:00 AM
	// TODO: this shouldn't be hardcoded probably
	const lastTime = times.at(-1);
	if (lastTime === "1:45 am") {
		times.push("2:00 am");
	} else if (lastTime === "4:45 pm") {
		times.push("5:00 pm");
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
	times: string[];
	rowIdx: number;
	columnIdx: number;
}) => {
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
	timeStart: string;
	timeEnd: string;
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
	times: string[];
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

const main = async () => {
	const scheduleUrl = `${baseUrl}/schedule/index/2024`;
	const response = await fetch(scheduleUrl);
	const text = await response.text();

	const dom = new JSDOM(text, { url: scheduleUrl });
	const { document, HTMLTableElement } = dom.window;

	const scheduleTables = document.querySelectorAll("table.schedule-table");
	const [fridaySchedule, saturdaySchedule, sundaySchedule] = scheduleTables;

	// Ignore last 2 rows -- they are duplicates
	const [buildingRow, roomRow, ...eventRows] = Array.from(
		fridaySchedule.querySelectorAll("tr"),
	).slice(0, -2);

	const locations = parseLocations(buildingRow, roomRow);

	const times = parseTimes(eventRows);

	if (!(fridaySchedule instanceof HTMLTableElement)) {
		throw new Error("Schedule table didn't return <table> element");
	}
	const eventPartialMap = parseEvents({
		table: fridaySchedule,
		locations,
		times,
	});
	const partialEvents = Object.values(eventPartialMap);
	console.log(`Parsed ${partialEvents.length} events from schedule table`);

	const events: Event[] = [];
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

	console.log({
		events,
	});
};

main();
