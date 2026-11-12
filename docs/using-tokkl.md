# Using Tokkl

[Documentation](README.md) · [Install Tokkl](hosting/README.md)

## Sign in or register

Open the Tokkl URL supplied by your server's administrator and sign in. If public
sign-up is enabled, register and follow the verification email. Otherwise, ask an
administrator for an invite. Each account has its own private workspace.

## Time settings

The Admin page manages accounts, session and invite lifetimes, and time resolution.
Stopped entries snap to a five-minute grid by default, so saved timestamps can
differ from those submitted. Entries that round to zero are refused or trashed.

CSV imports and JSON restores keep entry times from the file without snapping.
See [time-resolution behavior](PRD.md#63-behavior-details-that-clients-depend-on).

## Bring your data

Settings → Data imports Toggl Track CSV files and restores Tokkl JSON exports.
It also exports data for the signed-in account. Follow the
[import and export guide](data.md) for the steps and what each format contains.

## Connect other clients

Use the [Toggl-compatible API](api.md) to connect scripts and clients that accept
a custom server URL. Desktop timer companions ship separately on
[GitHub releases](https://github.com/e0ipso/tokkl/releases). See installation,
supported systems and builds:

- [KDE Plasma panel widget](../desktop/kde/README.md)
- [macOS menu bar app](../desktop/macos/README.md)
- [GNOME Shell extension and timer service](../desktop/gnome/README.md)

## Administer accounts

### Create the first administrator

After starting a new server, open its URL and enter the setup code printed in
its log to create the first administrator. For a local source installation the
URL is `http://localhost:8080`; a hosted instance uses the URL configured by its
operator. Treat the setup code as a secret.

### Invites and registration

Admins share one-use invite and password-reset links manually. These links are
not sent by email. Admins cannot access other accounts' workspaces.

Public sign-up is off by default. An operator can
[configure verification email and enable sign-up](hosting/configuration.md#enable-public-sign-up).
Each account gets its own private workspace.
