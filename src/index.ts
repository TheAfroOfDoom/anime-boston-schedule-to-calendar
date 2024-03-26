import { JSDOM } from "jsdom";
import normalizeHtmlTable from "@eirikb/normalize-html-table";

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
	return eventRows.map((eventRow) => {
		const time = eventRow.querySelector("th.schedule-time")?.textContent;
		if (time == null) {
			throw new Error("Failed to parse time from first column");
		}
		return time;
	});
};

type Event = {
	name: string;
	timeStart: string;
	timeEnd: string;
	location: string;
};

type EventMap = {
	[name: string]: Event;
};

const parseEvents = ({
	locations,
	table,
	times,
}: {
	locations: string[];
	table: HTMLTableElement;
	times: string[];
}): EventMap => {
	const eventMap: EventMap = {};

	const normalizedTable = normalizeHtmlTable(table);

	// Initial row index of the first event row in the table is 2 (the 3rd row)
	let rowIdx = -1;
	const initialColumnIdx = -1;
	let columnIdx = initialColumnIdx;

	for (const eventRow of normalizedTable) {
		rowIdx += 1;
		for (const eventElement of eventRow) {
			columnIdx += 1;

			const eventString = eventElement.textContent?.trim();

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

			const timeEnd = "TODO";

			const event: Event = {
				name: eventString,
				timeStart: times[rowIdx],
				timeEnd,
				location: locations[columnIdx + 1],
			};
			eventMap[eventString] = event;
		}
		columnIdx = initialColumnIdx;
	}

	return eventMap;
};

const main = async () => {
	const scheduleUrl = "https://www.animeboston.com/schedule/index/2024";
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
	const eventMap = parseEvents({ table: fridaySchedule, locations, times });
	const events = Object.values(eventMap);

	console.log({
		events: events.filter((event) => event.name.includes("Persona")),
	});
};

main();
