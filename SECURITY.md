# Security policy

## Supported versions

Only the latest release receives security fixes while the project is in its 0.x phase.

| Version | Supported |
|---|---|
| latest 0.x release | yes |
| older releases | no |

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through
GitHub: [Report a vulnerability](https://github.com/christophwalser/my-sweet-home/security/advisories/new)
(repository tab "Security" → "Report a vulnerability").

Please include:

- the affected version or commit,
- the steps to reproduce, ideally with a sample file (`.sh3d`, `.sh3f`, `.sh3t`, model or
  texture) that triggers the problem,
- what an attacker could achieve (e.g. crash, reading or writing files, running code).

You can expect a first answer within 7 days. Fixes are released as soon as possible, and
reporters are credited in the release notes unless they prefer otherwise.

## Scope

In scope are in particular:

- opening untrusted files: homes, libraries, imported models and textures, catalog feeds,
- the local control channels: the named pipe `\\.\pipe\my-sweet-home`, the CLI and the MCP
  server,
- the Tauri configuration (content security policy, capabilities) and IPC commands,
- the build and release pipeline in `.github/workflows`.

Out of scope: vulnerabilities in third-party libraries that are already published (please
report them upstream; dependency updates are tracked by Dependabot), and problems that
require an attacker who already controls the user's account.
