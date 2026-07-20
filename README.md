<h1 align="center">
    @badisi/check-updates
</h1>

<p align="center">
    📦 <i>An interactive CLI to scan, visualize and upgrade NPM dependencies — locally or globally.</i><br/>
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@badisi/check-updates">
        <img src="https://img.shields.io/npm/v/@badisi/check-updates.svg?color=blue&logo=npm" alt="npm version" /></a>
    <a href="https://npmcharts.com/compare/@badisi/check-updates?minimal=true">
        <img src="https://img.shields.io/npm/dw/@badisi/check-updates.svg?color=7986CB&logo=npm" alt="npm donwloads" /></a>
    <a href="https://github.com/Badisi/check-updates/blob/main/LICENSE">
        <img src="https://img.shields.io/npm/l/@badisi/check-updates.svg?color=ff69b4" alt="license" /></a>
</p>

<p align="center">
    <a href="https://github.com/Badisi/check-updates/actions/workflows/ci_tests.yml">
        <img src="https://img.shields.io/github/actions/workflow/status/badisi/check-updates/ci_tests.yml?logo=github" alt="build status" /></a>
    <a href="https://github.com/Badisi/check-updates/blob/main/CONTRIBUTING.md#-submitting-a-pull-request-pr">
        <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome" /></a>
</p>

<hr/>

## Getting started

This tool scans your project's dependencies, checks for updates on the NPM registry and presents them in a sortable, color-coded table.

In interactive mode, select exactly which packages to upgrade and whether to use the **Wanted** or **Latest** version. The tool then updates your `package.json` files in place while preserving your existing semver ranges and optionally runs `npm install` to apply the changes.


## Installation

```sh
npm install -g @badisi/check-updates
```

```sh
yarn add @badisi/check-updates
```


## Features

✅ **Interactive table UI** — browse, search and toggle package upgrades - grouped by update severity<br/>
✅ **Wanted vs Latest** — upgrade to either: the highest version satisfying your semver range or the absolute latest<br/>
✅ **Color-coded diffs** — instantly see what changed: red for major, cyan for minor, green for patch<br/>
✅ **Diagnosis** — understand what's missing, unsynced, invalid, unsatisfied, unavailable or at the latest version<br/>
✅ **Smart range preservation** — caret (`^`), tilde (`~`), exact, wildcard, hyphen and OR ranges are all preserved when writing upgrades<br/>
✅ **Monorepo-aware** — scan multiple `package.json` files in a single run using glob patterns<br/>
✅ **Global support** — check and upgrade global NPM packages<br/>
✅ **Caching** — reduce registry requests and speed up subsequent runs<br/>
✅ **Post-upgrade install** — optionally run `npm install` automatically after applying changes<br/>

> **Note:** Global package checking and the post-upgrade install step currently support only **npm**. Pull requests to add support for other package managers are very welcome.

![CLI utility preview][clipreview]


## Usage

```sh
check-updates [path...] [options]

# or using the shorthand alias:
bcu [path...] [options]

# or without installation, using `npx` directly:
npx @badisi/check-updates [path...] [options]
```


#### Arguments

| Argument | Description |
| :--- | :--- |
| `path...` | One or more file paths, folder paths or glob patterns.</br>*Defaults to the current working directory*. |


#### Options

| Option | Description |
| :--- | :--- |
| `-i, --interactive` | Run in interactive mode with a table UI to choose updates and optionally run `npm install`. |
| `-g, --global` | Check globally installed packages instead of local `package.json` files. |
| `-c, --cache` | Enable caching to reduce network requests. |
| `--all` | Show up-to-date packages alongside outdated ones. |
| `-v, --version` | Print the tool version. |
| `-h, --help` | Show help information. |


#### Examples

* **Check global packages**

Visualize and select upgrades for globally installed packages:
```sh
check-updates -g
```

* **Interactive Mode (Recommended)**

Interactively choose which updates to apply to your `package.json` files:
```sh
check-updates -i
```

* **Check specific directories, files or glob patterns**

By default, the tool looks for `package.json` in the current directory, but you can specify any number of targets:
```sh
# Check a folder
check-updates path/to/folder

# Check a specific file
check-updates path/to/package.json

# Check multiple files or glob patterns
check-updates ./package.json ./packages/core/package.json
check-updates "./**/package.json" "{,projects/**/}package.json"
```

* **Include up-to-date packages**

By default, up-to-date dependencies are hidden. To show everything run:
```sh
check-updates --all
```

* **Enable cache**

Speed up repeated runs by caching registry responses:
```sh
check-updates -c
```


## Development

See the [developer docs][developer].


## Contributing

#### > Want to Help ?

Want to file a bug, contribute some code or improve documentation ? Excellent!

But please read up first on the guidelines for [contributing][contributing], and learn about submission process, coding rules and more.

#### > Code of Conduct

Please read and follow the [Code of Conduct][codeofconduct] and help us keep this project open and inclusive.




[clipreview]: https://github.com/Badisi/check-updates/blob/main/cli_preview.png
[developer]: https://github.com/Badisi/check-updates/blob/main/DEVELOPER.md
[contributing]: https://github.com/Badisi/check-updates/blob/main/CONTRIBUTING.md
[codeofconduct]: https://github.com/Badisi/check-updates/blob/main/CODE_OF_CONDUCT.md
