# Privacy Policy for Add to Nuvio

**Effective date:** September 19, 2026  
**Publisher:** innovaciones

Add to Nuvio is an independent Chrome extension that lets you add or remove movies and TV series from your Nuvio library while browsing IMDb, Letterboxd, Rotten Tomatoes, and TMDB. This policy explains what information the extension handles and why.

## Information the extension handles

- **Nuvio session:** When you visit `nuvio.tv` while signed in, the extension reads your Nuvio access token, refresh token, session expiration, and active profile ID from that site's local storage. It saves the session in Chrome's local extension storage so it can make authenticated Nuvio requests on your behalf.
- **Profiles and library status:** The extension retrieves your Nuvio profile IDs and names and checks the selected profile's library to show whether the current title is already saved. It stores the profile list and your selected profile locally.
- **Title information:** On supported title pages, the extension reads the information needed to identify a movie or series, such as its IMDb or TMDB ID, title, release year, and available metadata. When you add a title, metadata such as its name, poster, description, rating, and genres may be included in the library entry.
- **Client identifier:** The extension generates and stores a random client identifier used when sending library changes to Nuvio.

The extension does not collect a general browsing history or read unrelated websites. It has no analytics or advertising code.

## How information is used and shared

The extension uses this information only to identify the title, show its library status, select a Nuvio profile, and add or remove the title at your request.

- It sends your session token to `api.nuvio.tv` over HTTPS to refresh your session, retrieve profiles and library status, and update your selected library.
- It requests title matches and metadata from `catalog.nuvio.tv` over HTTPS. These requests may include a title name, year, or title identifier, but not your Nuvio session token.
- It does **not** send your Nuvio session token to IMDb, Letterboxd, Rotten Tomatoes, or TMDB.

Nuvio operates the API and catalog services and may process requests under its own privacy practices. The extension publisher does not operate a separate analytics or data-collection server for this extension and does not sell or share your information for advertising.

## Local storage and retention

The session, profile information, selected profile, and client identifier are stored in `chrome.storage.local` in your Chrome profile. When the extension detects that you have signed out of Nuvio (while a Nuvio tab is open or after you revisit it), it removes the stored session and profile list. The selected profile ID and client identifier may remain until you clear the extension's data or uninstall it. Library entries saved in your Nuvio account are controlled by Nuvio and are not deleted when you uninstall the extension.

## Your choices

You can switch Nuvio profiles from the extension's button, remove a saved title by clicking **In Nuvio**, sign out of Nuvio, or uninstall the extension. You can also clear the extension's local data through Chrome. Clearing local data signs the extension out until you visit Nuvio again; it does not delete titles from your Nuvio account.

## Security

Requests to Nuvio use HTTPS. The extension's executable code is packaged with the extension rather than loaded from a remote server. Like other locally stored browser data, the saved session should be protected by securing your device and Chrome profile.

## Changes and contact

If this policy or the extension's data practices change, the updated policy will be posted here with a new effective date. For questions, use the publisher's support contact on the Chrome Web Store listing or [open a GitHub issue](https://github.com/innovaciones/add-to-nuvio/issues). Do not include access tokens or other private information in a public issue.

Add to Nuvio is not affiliated with or endorsed by Nuvio or the supported title sites.
