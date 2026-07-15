/* eslint-disable @typescript-eslint/naming-convention */

import Enquirer from 'enquirer';
import { stripVTControlCharacters as strip, styleText } from 'node:util';
import semverDiff from 'semver/functions/diff';
import semverGt from 'semver/functions/gt';
import semverMajor from 'semver/functions/major';
import semverMin from 'semver/ranges/min-version';

import type { PackageUpdate } from './index';
import { colorizeDiff } from './utils';

/** Used to fix Enquirer missing types */
declare module 'enquirer' {
    /* eslint-disable @typescript-eslint/method-signature-style */
    interface Prompt<V = string> {
        state: {
            size: number;
            submitted: boolean;
            canceled: boolean;
        };
        value: V;
        stdout: NodeJS.WriteStream;
        clear(lines?: number): void;
        close(): Promise<void>;
        render(): void;
        run(): Promise<V>;
        submit(value?: unknown): Promise<void>;
        up(): void;
        down(): void;
        left(): void;
        right(): void;
        space(): void;
    }
    /* eslint-enable @typescript-eslint/method-signature-style */
}

type Color = Parameters<typeof styleText>[0];

interface RenderLine {
    rowIndex: number;
    line: string;
    groupId: TableRowGroupId;
    groupColor: Color;
    groupTitle?: string;
    groupTitleRaw?: string;
    groupDesc?: string;
}

type TablePromptOptions = Omit<ConstructorParameters<typeof Enquirer.Prompt>[0], 'name' | 'type' | 'message'> & {
    interactive: boolean;
    updates: PackageUpdate[];
};

type TableColumnId = Exclude<keyof TableRow, 'groupId' | 'isWantedSelectable' | 'isLatestSelectable'>;

interface TableColumn {
    id: TableColumnId;
    label: string;
    align: 'left' | 'center' | 'right';
    maxLength: number;
    isSelectable: boolean;
}

type TableRowGroupId
    = 'patch' | 'minor' | 'major' | 'majorVersionZero' | 'missing' | 'unsynced' | 'invalid' | 'unsatisfied' | 'unavailable' | 'latest';

interface TableRowGroup {
    id: TableRowGroupId;
    color: Color;
    title: string;
    desc: string;
};

interface TableRow {
    groupId: TableRowGroupId;
    separator: string;
    pkgName: string;
    tagOrRange: string;
    installed: string;
    wanted: string;
    isWantedSelectable: boolean;
    latest: string;
    isLatestSelectable: boolean;
    url: string;
}

export interface TableSelectedItem {
    pkgName: string;
    tagOrRange: string;
    installed: string;
    selected: string;
}

const CHEVRON = '❯ ';
const CHECKBOX_ON = ' ◉ ';
const CHECKBOX_OFF = ' ◯ ';

export class TablePrompt extends Enquirer.Prompt<TableSelectedItem[]> {
    private COLUMN_GAP = 3;

    private interactive = false;
    private rows: TableRow[] = [];
    private columns: TableColumn[] = [];
    private updates: PackageUpdate[] = [];

    private currentRowIndex = 0;
    private currentColumnIndex = 0; // 0 = Wanted, 1 = Latest

    private selectedUpdates = new Map<string, 'wanted' | 'latest'>();

    public constructor(options: TablePromptOptions) {
        // @ts-expect-error Not assignable to parameter of type 'PromptOptions | undefined'
        super(options);

        this.interactive = options.interactive;
        this.updates = options.updates;
    }

    public override async run(): Promise<TableSelectedItem[]> {
        this.stdout.write('\u001b[?25l'); // Hide cursor

        this.rows = getTableRows(this.updates);
        this.columns = getTableColumns(this.rows, this.interactive);
        if (this.interactive) {
            this.ensureValidCurrentColumnIndex();
        }
        return await super.run();
    };

    public override render(): void {
        if (this.state.submitted || this.state.canceled) {
            this.clear();
            return;
        }

        const renderLines = this.getRenderLines();

        // Pagination logic
        const terminalHeight = Math.max(10, (process.stdout.rows - 2 || 24) - 4); // leave room for context printed above (intro, file path, spinner)
        const fixedLines = (this.interactive ? 7 : 6) + 1 + 1 + 2; // Message + Instructions + Header + Last empty + Box borders

        const { start, end } = this.getPagination(renderLines, terminalHeight, fixedLines);
        const lines = this.assembleLines(renderLines, start, end);

        const output = drawBox(lines.filter((l): l is string => l !== undefined));
        this.clear();
        this.stdout.write(output);
        this.state.size = output.split('\n').length - 1;
    };

    public override clear(): void {
        if (this.state.size > 0) {
            this.stdout.write(`\u001b[${this.state.size}A\r\u001b[J`);
            this.state.size = 0;
        }
    }

    public override async close(): Promise<void> {
        try {
            await super.close();
        } catch (error) {
            if (error && (typeof error === 'object') && ('code' in error) && (error.code !== 'ERR_USE_AFTER_CLOSE')) {
                throw error;
            }
        } finally {
            this.stdout.write('\u001b[?25h'); // Show cursor
        }
    }

    public override up(): void {
        if (this.currentRowIndex > 0) {
            this.currentRowIndex -= 1;
            if (this.interactive) {
                this.ensureValidCurrentColumnIndex();
            }
        }
        this.render();
    }

    public override down(): void {
        if (this.currentRowIndex < this.rows.length - 1) {
            this.currentRowIndex += 1;
            if (this.interactive) {
                this.ensureValidCurrentColumnIndex();
            }
        }
        this.render();
    }

    public override left(): void {
        if (this.interactive) {
            const row = this.rows[this.currentRowIndex];
            if (row.isWantedSelectable) {
                this.currentColumnIndex = 0;
                this.render();
            }
        }
    }

    public override right(): void {
        if (this.interactive) {
            const row = this.rows[this.currentRowIndex];
            if (row.isLatestSelectable) {
                this.currentColumnIndex = 1;
                this.render();
            }
        }
    }

    public override space(): void {
        if (this.interactive) {
            const row = this.rows[this.currentRowIndex];
            const selectedType = (this.currentColumnIndex === 0) ? 'wanted' : 'latest';
            const isSelectable = (selectedType === 'wanted') ? row.isWantedSelectable : row.isLatestSelectable;

            if (isSelectable) {
                const currentType = this.selectedUpdates.get(row.pkgName);
                if (currentType === selectedType) {
                    this.selectedUpdates.delete(row.pkgName);
                } else {
                    this.selectedUpdates.set(row.pkgName, selectedType);
                }
                this.render();
            }
        }
    }

    public override async submit(): Promise<void> {
        this.state.submitted = true;
        this.render();
        this.stdout.write('\u001b[?25h'); // Show cursor
        this.value = Array.from(this.selectedUpdates.entries())
            .reduce<TableSelectedItem[]>((items, [pkgName, type]) => {
                const row = this.rows.find(r => r.pkgName === pkgName);
                if (row) {
                    items.push({ pkgName, tagOrRange: row.tagOrRange, installed: row.installed, selected: row[type] });
                }
                return items;
            }, []);
        return super.submit();
    }

    // --- HELPER(s) ---

    private getRenderLines(): RenderLine[] {
        const groups = getTableRowGroups();
        return this.rows.reduce<RenderLine[]>((items, row, index) => {
            const group = groups.find(g => g.id === row.groupId);
            if (!group) { return items; }

            const isFirstInGroup = (items.length === 0) || (items[items.length - 1].groupId !== group.id);
            const groupTitle = (isFirstInGroup) ? styleText(group.color, `${styleText('bold', group.title)} ${styleText('italic', `(${group.desc})`)}`) : undefined;

            const isFocusedRow = (this.currentRowIndex === index);
            const chevron = isFocusedRow ? styleText('white', CHEVRON) : ' '.repeat(CHEVRON.length);

            const line = this.columns.map(column => {
                const isSelectable = this.interactive && ((column.id === 'wanted' && row.isWantedSelectable) || (column.id === 'latest' && row.isLatestSelectable));
                const isSelected = (this.selectedUpdates.get(row.pkgName) === column.id);
                const isFocused = this.interactive && isFocusedRow && isSelectable && column.isSelectable && ((column.id === 'wanted' ? this.currentColumnIndex === 0 : this.currentColumnIndex === 1));
                return cellRenderer(row, column, isFocused, isSelectable, isSelected);
            }).join(' '.repeat(this.COLUMN_GAP));

            items.push({
                rowIndex: index,
                line: chevron + line,
                groupId: group.id,
                groupTitle,
                groupColor: group.color,
                groupDesc: group.desc,
                groupTitleRaw: group.title,
            });

            return items;
        }, []);
    }

    private getPagination(renderLines: RenderLine[], terminalHeight: number, fixedLines: number): { start: number; end: number } {
        const getRequiredHeight = (s: number, e: number): number => {
            const initialCount = fixedLines + (s > 0 || e < renderLines.length ? 1 : 0);
            return renderLines.slice(s, e).reduce((accumulator, item, index) => {
                const absoluteIndex = index + s;
                const hasBonus = (absoluteIndex === s && !item.groupTitle) || item.groupTitle;
                const itemHeight = (hasBonus ? 2 : 0) + 1;
                return accumulator + itemHeight;
            }, initialCount);
        };

        let start = 0;
        let end = renderLines.length;
        const cursorIndex = Math.max(0, renderLines.findIndex(l => l.rowIndex === this.currentRowIndex));

        if (getRequiredHeight(0, renderLines.length) > terminalHeight - 1) {
            start = cursorIndex;
            end = cursorIndex + 1;

            const maxIterations = terminalHeight;
            for (let i = 0; i < maxIterations; i++) {
                let expanded = false;
                if (start > 0 && getRequiredHeight(start - 1, end) <= terminalHeight - 1) {
                    start--;
                    expanded = true;
                }
                if (end < renderLines.length && getRequiredHeight(start, end + 1) <= terminalHeight - 1) {
                    end++;
                    expanded = true;
                }
                if (!expanded) { break; }
            }
        }

        return { start, end };
    }

    private assembleLines(renderLines: RenderLine[], start: number, end: number): (string | undefined)[] {
        const lines: (string | undefined)[] = [
            '',
            styleText('white', '🔥 Important updates are available.'),
            '',
        ];

        if (this.interactive) {
            lines.push(
                styleText('gray', '↑/↓:   select a version'),
                styleText('gray', 'Space: toggle selection'),
                styleText('gray', 'Enter: upgrade'),
                '',
            );
        } else {
            lines.push(
                styleText('gray', '↑/↓:   scroll'),
                styleText('gray', 'Enter: quit'),
                '',
            );
        }

        lines.push(this.columns.map(columnHeaderRenderer).join(' '.repeat(this.COLUMN_GAP)));

        for (let i = start; i < end; i++) {
            const item = renderLines[i];
            if (i === start && !item.groupTitle) {
                lines.push('');
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                lines.push(styleText(item.groupColor, `${styleText('bold', item.groupTitleRaw!)} ${styleText('italic', `(${item.groupDesc!})`)}`));
            } else if (item.groupTitle) {
                lines.push('');
                lines.push(item.groupTitle);
            }
            lines.push(item.line);
        }

        if (start > 0 || end < renderLines.length) {
            lines.push('');
            lines.push(styleText(['gray'], `[items ${start + 1}-${end} of ${renderLines.length}]`));
        }

        lines.push('');
        return lines;
    }

    private ensureValidCurrentColumnIndex(): void {
        const row = this.rows[this.currentRowIndex];
        if (this.currentColumnIndex === 0 && !row.isWantedSelectable) {
            this.currentColumnIndex = 1;
        } else if (this.currentColumnIndex === 1 && !row.isLatestSelectable) {
            this.currentColumnIndex = 0;
        }
    }
}

// --- HELPER(s) ---

const getTableRows = (updates: PackageUpdate[]): TableRow[] => {
    const groupOrder = getTableRowGroups().map(group => group.id);
    return updates
        .map(pkg => {
            const item: TableRow = {
                groupId: getTableRowGroupIdForPackage(pkg),
                pkgName: pkg.name,
                tagOrRange: pkg.tagOrRange ?? 'unknown',
                separator: '  ➔',
                installed: pkg.installed ?? 'unknown',
                wanted: pkg.wanted ?? 'unknown',
                latest: pkg.latest ?? 'unknown',
                url: (pkg.homepage) ? `\u001b]8;;${pkg.homepage}\u001b\\${new URL(pkg.homepage).hostname}\u001b]8;;\u001b\\ 🔗` : '-',
                isWantedSelectable: false,
                isLatestSelectable: false,
            };

            const isRowSelectable = !['invalid', 'unavailable', 'latest'].includes(item.groupId);
            if (isRowSelectable) {
                if (item.installed !== item.wanted) {
                    item.isWantedSelectable = true;
                } else if (semverMin(item.tagOrRange)?.version !== item.wanted) {
                    item.isWantedSelectable = true;
                }

                if ((item.installed !== item.latest) && (item.wanted !== item.latest)) {
                    item.isLatestSelectable = true;
                } else if (pkg.installed && pkg.wanted && semverGt(pkg.installed, pkg.wanted)) {
                    item.isLatestSelectable = true;
                }
            }

            return item;
        })
        // Sort rows by their group
        .sort((a, b) => {
            if (a.groupId !== b.groupId) {
                return groupOrder.indexOf(a.groupId) - groupOrder.indexOf(b.groupId);
            }
            return a.pkgName.localeCompare(b.pkgName);
        });
};

const getTableColumns = (rows: TableRow[], interactive = false): TableColumn[] => {
    const columns: TableColumn[] = [
        { id: 'pkgName', label: 'Package', align: 'left', maxLength: 0, isSelectable: false },
        { id: 'tagOrRange', label: 'Range', align: 'right', maxLength: 0, isSelectable: false },
        { id: 'separator', label: '', align: 'center', maxLength: 0, isSelectable: false },
        { id: 'installed', label: 'Installed', align: 'right', maxLength: 0, isSelectable: false },
        { id: 'wanted', label: 'Wanted', align: 'right', maxLength: 0, isSelectable: true },
        { id: 'latest', label: 'Latest', align: 'right', maxLength: 0, isSelectable: true },
        { id: 'url', label: 'Homepage', align: 'left', maxLength: 0, isSelectable: false },
    ];
    rows.forEach(row => {
        columns.forEach(column => {
            let rowValueLength = strip(row[column.id]).length;
            if (interactive && column.isSelectable) {
                rowValueLength += CHECKBOX_ON.length;
            }
            if (column.id === 'pkgName') {
                rowValueLength += CHEVRON.length;
            }

            column.maxLength = Math.max(column.maxLength, rowValueLength, column.label.length);
        });
    });
    return columns;
};

const getTableRowGroupIdForPackage = (pkg: PackageUpdate): TableRowGroupId => {
    if (pkg.error) {
        return 'unavailable';
    } else if (!pkg.wanted) {
        return 'invalid';
    } else if (pkg.installed && pkg.wanted && semverGt(pkg.installed, pkg.wanted)) {
        return 'unsatisfied';
    } else if (pkg.installed && pkg.wanted && pkg.latest) {
        const newVersion = (pkg.installed !== pkg.wanted) ? pkg.wanted : pkg.latest;
        const releaseType = semverDiff(pkg.installed, newVersion);
        if (releaseType === null) {
            if (pkg.tagOrRange && (semverMin(pkg.tagOrRange)?.version !== pkg.wanted)) {
                return 'unsynced';
            }
            return 'latest';
        } else if (semverMajor(newVersion) === 0) {
            return 'majorVersionZero';
        } else if (['major', 'premajor', 'prerelease'].includes(releaseType)) {
            return 'major';
        } else if (['minor', 'preminor'].includes(releaseType)) {
            return 'minor';
        } else if (['patch', 'prepatch'].includes(releaseType)) {
            return 'patch';
        }
    }
    return 'missing';
};

const columnHeaderRenderer = (column: TableColumn): string => {
    const text = column.label;
    const gap = ' '.repeat(Math.max(0, column.maxLength - strip(text).length));
    const label = styleText('underline', text);
    return (column.align === 'right') ? `${gap}${label}` : `${label}${gap}`;
};

const cellRenderer = (row: TableRow, column: TableColumn, isFocused = false, isSelectable = false, isSelected = false): string => {
    let content = row[column.id];

    if (!isFocused) {
        switch (column.id) {
            case 'installed':
            case 'tagOrRange':
                content = styleText('gray', content);
                break;
            case 'separator':
                content = styleText('gray', content);
                break;
            case 'url':
                content = styleText('blue', content);
                break;
            case 'pkgName':
                content = styleText('yellow', content);
                break;
            case 'wanted':
                if (row.installed === 'missing') {
                    content = styleText('blue', row.wanted);
                } else if (!row.isWantedSelectable) {
                    content = styleText('gray', row.wanted);
                } else {
                    content = colorizeDiff(row.installed, row.wanted);
                }
                break;
            case 'latest':
                if (!row.isLatestSelectable && row.latest === row.wanted) {
                    content = styleText('gray', row.latest);
                } else if (!row.isLatestSelectable && row.latest === row.installed) {
                    content = styleText('gray', row.latest);
                } else {
                    content = colorizeDiff(row.installed, row.latest);
                }
                break;
            default: break;
        }
    }

    let contentLength = strip(content).length;
    if (column.id === 'pkgName') {
        contentLength += CHEVRON.length;
    }
    if (column.isSelectable) {
        const checkboxIcon = isSelected ? styleText('green', CHECKBOX_ON) : styleText('gray', CHECKBOX_OFF);
        const checkbox = (isSelectable) ? checkboxIcon : '';
        const gap = ' '.repeat(Math.max(0, column.maxLength - contentLength - strip(checkbox).length));
        content = `${checkbox}${gap}${content}`;
    } else {
        const gap = ' '.repeat(Math.max(0, column.maxLength - contentLength));
        content = (column.align === 'right') ? `${gap}${content}` : `${content}${gap}`;
    }

    return (isFocused) ? styleText('inverse', content) : content;
};

const getTableRowGroups = (): TableRowGroup[] => [
    { id: 'patch', color: 'green', title: 'Patch', desc: 'backwards-compatible bug fixes' },
    { id: 'minor', color: 'cyan', title: 'Minor', desc: 'backwards-compatible features' },
    { id: 'major', color: 'red', title: 'Major', desc: 'potentially breaking API changes' },
    { id: 'majorVersionZero', color: 'magenta', title: 'Major version zero', desc: 'not stable, anything may change' },
    { id: 'unsynced', color: '#c8683b', title: 'Not-synced', desc: 'installed version is not synced with the range' },
    { id: 'unsatisfied', color: '#c8683b', title: 'Unsatisfied', desc: 'installed version is outside the range' },
    { id: 'invalid', color: '#c8683b', title: 'Invalid', desc: 'wrong range' },
    { id: 'missing', color: '#c8683b', title: 'Missing', desc: 'not installed' },
    { id: 'unavailable', color: '#c8683b', title: 'Unavailable', desc: 'registry error' },
    { id: 'latest', color: 'gray', title: 'Latest', desc: 'no newer updates available' },
];

const drawBox = (lines: string[], color: Color = 'cyan', horizontalPadding = 3): string => {
    const results: string[] = [];
    const maxLineWidth = lines.reduce((max, row) => Math.max(max, strip(row).length), 0);

    results.push(styleText(color, `┌${'─'.repeat(maxLineWidth + (horizontalPadding * 2))}┐`));
    lines.forEach(row => {
        const padding = ' '.repeat(horizontalPadding);
        const fullRow = `${row}${' '.repeat(maxLineWidth - strip(row).length)}`;
        results.push(`${styleText(color, '│')}${padding}${fullRow}${padding}${styleText(color, '│')}`);
    });
    results.push(styleText(color, `└${'─'.repeat(maxLineWidth + (horizontalPadding * 2))}┘`));
    return results.join('\n');
};
