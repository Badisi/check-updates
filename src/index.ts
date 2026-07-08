import { latestVersion, type PackageJson } from '@badisi/latest-version';
import { box, confirm, intro, isCancel, log, outro, spinner } from '@clack/prompts';
import glob from 'fast-glob';
import { exec, spawn } from 'node:child_process';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { promisify, styleText } from 'node:util';

import { version as packageVersion } from '../package.json';
import { TablePrompt, type TableSelectedItem } from './table-prompt';
import { colorizeDiff, getPackageHomePage, updateSemverRange } from './utils';

interface UpdateResult {
    pkgName: string;
    currentValue: string;
    newValue: string;
};

export interface PackageUpdate {
    name: string;
    homepage?: string;
    tagOrRange?: string;
    installed?: string;
    wanted?: string;
    latest?: string;
    error?: Error;
}

interface Options {
    global: boolean;
    interactive: boolean;
    cache: boolean;
    all: boolean;
    help: boolean;
    version: boolean;
    args: string[];
}

const updatePackageJson = async (path: string, updates: UpdateResult[]): Promise<void> => {
    try { await access(path); } catch { return; }

    const content = await readFile(path, 'utf8');
    const pkg = JSON.parse(content) as Record<
        'dependencies' | 'devDependencies' | 'peerDependencies',
        Record<string, string> | undefined
    >;

    updates.forEach(({ pkgName, newValue }) => {
        if (pkg.dependencies?.[pkgName]) {
            pkg.dependencies[pkgName] = newValue;
        } else if (pkg.devDependencies?.[pkgName]) {
            pkg.devDependencies[pkgName] = newValue;
        } else if (pkg.peerDependencies?.[pkgName]) {
            pkg.peerDependencies[pkgName] = newValue;
        }
    });

    // Detect indentation
    const indentMatch = /^\s+/m.exec(content);
    const indent = indentMatch ? indentMatch[0] : 4;

    await writeFile(path, `${JSON.stringify(pkg, null, indent)}\n`);
};

const ask = async (message: string): Promise<boolean> => {
    const ret = await confirm({ message, initialValue: true });
    if (isCancel(ret)) {
        process.stdout.write('\x1B[1A\x1B[2K');
        outro(styleText('red', 'Canceled.'));
        process.exit(0);
    }
    return ret;
};

const askInstall = async (global = false, args: string[] = []): Promise<void> => {
    const cmdLabel = (global) ? 'npm install -g' : 'npm install';
    const npmCmd = (process.platform === 'win32') ? 'npm.cmd' : 'npm';
    const npmArgs = (global) ? ['install', '-g', ...args] : ['install'];

    if (await ask(`Run ${styleText(['cyan'], cmdLabel)} to install dependencies ?`)) {
        // Make sure the installation occurs after the program ends
        setTimeout(() => {
            console.log(`> ${npmCmd} ${npmArgs.join(' ')}`);

            const child = spawn(npmCmd, npmArgs, { stdio: 'inherit' });
            child.on('exit', code => {
                process.exit(code ?? 1);
            });
        });
    }
};

const startSpinner = (message: string): ReturnType<typeof spinner> => {
    const s = spinner({
        onCancel: (): void => {
            outro(styleText('red', 'Canceled.'));
            process.exit(0);
        },
    });
    s.start(message);
    return s;
};

const displayUpdateResults = (items: UpdateResult[], title = ''): void => {
    const max = (key: keyof UpdateResult): number => Math.max(...items.map(i => i[key].length), 1);
    const [maxName, maxCurrentValue, maxNewValue] = [max('pkgName'), max('currentValue'), max('newValue')];
    const info = items
        .map(item => {
            const padNewValue = maxNewValue - item.newValue.length;
            const colorizedNewValue = `${' '.repeat(padNewValue)}${colorizeDiff(item.currentValue, item.newValue)}`;
            return `${item.pkgName.padEnd(maxName)}    ${item.currentValue.padStart(maxCurrentValue)}  →  ${colorizedNewValue}`;
        })
        .join('\n');
    box(info, styleText('cyan', title), {
        width: 'auto',
        rounded: true,
        formatBorder: (value: string): string => styleText('cyan', value),
    });
};

const displayUpdates = async (updates: PackageUpdate[], interactive: boolean): Promise<TableSelectedItem[]> => {
    if (updates.length) {
        const prompt = new TablePrompt({ updates, interactive });
        prompt.on('cancel', () => {
            process.stdout.write('\x1B[1A\x1B[2K');
            outro(styleText('red', 'Canceled.'));
            process.exit(0);
        });

        const selectedUpdates = await prompt.run();
        if (interactive) {
            if (selectedUpdates.length) {
                return selectedUpdates;
            } else {
                process.stdout.write('\x1B[1A\x1B[2K');
                log.warn(styleText('yellow', 'No updates selected.'));
            }
        }
    } else {
        process.stdout.write('\x1B[1A\x1B[2K');
        log.success(styleText('green', '💚 Packages are up-to-date'));
    }
    return [];
};

const displayHelp = (header: string): void => {
    console.log([
        header,
        '',
        styleText('bold', 'VERSION:'),
        `    ${styleText('blue', packageVersion)}`,
        '',
        styleText('bold', 'USAGE:'),
        '    $ check-updates [path...] [options]',
        '    $ cu [path...] [options]',
        '',
        styleText('bold', 'ARGUMENTS:'),
        `    ${styleText('cyan', '[path...]')}          One or more file paths, folder paths or glob patterns`,
        `    ${styleText(['gray', 'italic'], '                   (defaults to the current working directory)')}`,
        '',
        styleText('bold', 'OPTIONS:'),
        `    ${styleText('cyan', '-g, --global')}       Apply updates globally`,
        `    ${styleText('cyan', '-i, --interactive')}  Run in interactive mode with prompts`,
        `    ${styleText('cyan', '--all')}              Include up-to-date packages in the output`,
        `    ${styleText('cyan', '-c, --cache')}        Enable caching to speed up operations`,
        `    ${styleText('cyan', '-v, --version')}      Print this package version`,
        `    ${styleText('cyan', '-h, --help')}         Show this help information map`,
    ].join('\n'), '\n');
};

const getNpmGlobalPackages = async (): Promise<string[]> => {
    try {
        const { stdout } = await promisify(exec)('npm list -g --depth=0 --json');
        const dependencies = (JSON.parse(stdout) as PackageJson).dependencies as Record<string, unknown> | undefined;
        return dependencies ? Object.keys(dependencies) : [];
    } catch {
        return [];
    }
};

const readOptions = (): Options => {
    const args = process.argv.slice(2);

    const hasFlag = (long: string, short?: string): boolean =>
        args.includes(long) || args.some(a => /^-[^-]/.test(a) && short && a.includes(short));

    return {
        global: hasFlag('--global', 'g'),
        interactive: hasFlag('--interactive', 'i'),
        cache: hasFlag('--cache', 'c'),
        all: hasFlag('--all'),
        help: hasFlag('--help', 'h'),
        version: hasFlag('--version', 'v'),
        args: args.filter(arg => !arg.startsWith('-')),
    };
};

const resolvePackagePaths = async (args: string[]): Promise<string[]> => {
    if (args.length === 0) {
        args.push('package.json');
    }

    const resolvedFiles = new Set<string>();
    for (const arg of args) {
        const normalizedArg = arg.replace(/\\/g, '/');
        try {
            const stats = await stat(normalizedArg);
            if (stats.isDirectory()) {
                const innerPkg = resolve(normalizedArg, 'package.json');
                if ((await stat(innerPkg)).isFile()) {
                    resolvedFiles.add(innerPkg);
                }
            } else if (stats.isFile() && (basename(normalizedArg) === 'package.json')) {
                resolvedFiles.add(resolve(arg));
            }
        } catch {
            const matchedFiles = await glob(normalizedArg, { onlyFiles: true, absolute: true });
            for (const file of matchedFiles) {
                if (basename(file) === 'package.json') {
                    resolvedFiles.add(file);
                }
            }
        }
    }
    return Array.from(resolvedFiles);
};

void (async (): Promise<void> => {
    console.log(); // margin-top

    const header = `📦 ${styleText(['bgCyan', 'black'], ' check-updates ')}`;

    const options = readOptions();
    if (options.version) {
        console.log(`v${packageVersion}`);
        return;
    } else if (options.help) {
        displayHelp(header);
        return;
    }

    intro(header);

    if (options.global) {
        const s = startSpinner(styleText('cyan', 'Checking updates'));
        const packages = (await getNpmGlobalPackages()).map(pkg => `${pkg}@latest`);
        let latestVersions = await latestVersion(packages, { useCache: options.cache });
        if (!options.all) {
            latestVersions = latestVersions.filter(item => (item.updatesAvailable && item.updatesAvailable.globalNpm) || item.error);
        }
        const updates: PackageUpdate[] = await Promise.all(latestVersions
            .map(async ({ name, wantedTagOrRange: tagOrRange, globalNpm: installed, wanted, latest, error }) => {
                const homepage = await getPackageHomePage(name);
                return { name, homepage, tagOrRange, installed, wanted, latest, error };
            }));
        s.clear();

        const selectedUpdates = await displayUpdates(updates, options.interactive);
        if (selectedUpdates.length) {
            const results: UpdateResult[] = selectedUpdates.map(item => ({
                pkgName: item.pkgName,
                currentValue: item.installed,
                newValue: item.selected,
            }));
            displayUpdateResults(results);
            if (options.interactive) {
                await askInstall(true, results.map(r => `${r.pkgName}@${r.newValue}`));
            }
        }
    } else {
        const s = startSpinner(styleText('cyan', `Searching ${styleText('bold', 'package.json')} files`));
        const pkgJsonPaths = await resolvePackagePaths(options.args);
        s.clear();
        process.stdout.write('\x1B[1A\x1B[2K');

        let hasUpdates = false;
        for (const [index, path] of pkgJsonPaths.entries()) {
            const step = (pkgJsonPaths.length > 1) ? `${styleText(['bold', 'cyan'], `[${index + 1}/${pkgJsonPaths.length}]`)} ` : '';
            log.info(`${step}${styleText('white', path)}`);

            const s1 = startSpinner(styleText('cyan', 'Checking updates'));
            const pkgJson = JSON.parse(await readFile(path, { encoding: 'utf8' })) as PackageJson;
            let latestVersions = await latestVersion(pkgJson, { useCache: options.cache });
            if (!options.all) {
                latestVersions = latestVersions.filter(item => (item.local !== item.wanted) || (item.local !== item.latest) || item.error);
            }
            const updates: PackageUpdate[] = await Promise.all(latestVersions
                .map(async ({ name, wantedTagOrRange: tagOrRange, local: installed, wanted, latest, error }) => {
                    const homepage = await getPackageHomePage(name);
                    return { name, homepage, tagOrRange, installed, wanted, latest, error };
                }));
            s1.clear();

            const selectedUpdates = await displayUpdates(updates, options.interactive);
            if (selectedUpdates.length) {
                hasUpdates = true;

                const s2 = startSpinner(styleText('cyan', 'Updating package.json'));
                const results: UpdateResult[] = selectedUpdates.map(item => {
                    const newVersion = updateSemverRange(item.tagOrRange, item.selected);
                    return {
                        pkgName: item.pkgName,
                        currentValue: item.tagOrRange,
                        newValue: newVersion,
                    };
                });
                await updatePackageJson(path, results);
                s2.clear();
                process.stdout.write('\x1B[1A\x1B[2K');

                displayUpdateResults(results, '  Package.json updated  ');
            }
        }

        if (options.interactive && hasUpdates) {
            await askInstall();
        }
    }

    outro(styleText('gray', 'Done.'));
})();
