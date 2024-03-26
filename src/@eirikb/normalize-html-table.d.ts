declare module "@eirikb/normalize-html-table" {
	function normalizeHtmlTable(
		table: HTMLTableElement,
	): HTMLTableCellElement[][];

	export default normalizeHtmlTable;
}
