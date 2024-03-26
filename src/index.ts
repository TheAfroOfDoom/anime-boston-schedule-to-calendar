import { JSDOM } from "jsdom";

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

const main = async () => {
	const scheduleUrl = "https://www.animeboston.com/schedule/index/2024";
	const response = await fetch(scheduleUrl);
	const text = await response.text();

	const dom = new JSDOM(text, { url: scheduleUrl });
	const { document } = dom.window;

	const scheduleTables = document.querySelectorAll(".schedule-table tbody");
	const [fridaySchedule, saturdaySchedule, sundaySchedule] = scheduleTables;

	// Ignore last 2 rows -- they are duplicates
	const [buildingRow, roomRow, ...eventRows] = Array.from(
		fridaySchedule.querySelectorAll("tr"),
	).slice(0, -2);

	const locations = parseLocations(buildingRow, roomRow);

	const times = parseTimes(eventRows);

	console.log({ rows, columns });
};

main();
