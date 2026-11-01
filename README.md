# MMM-EnvCanada
MagicMirror² Module to display weather forecast information from Environment Canada.

Version 2.0.3, updated October 2025, released August 2023 Copyright © Charles Morris

[![Platform](https://img.shields.io/badge/platform-MagicMirror-informational)](https://MagicMirror.builders)
![License](https://img.shields.io/badge/license-MIT-informational)

![Example Screenshot](screenshot.png?raw=true)
## Purpose
MMM-EnvCanada is a MagicMirror² Module to display Environment Canada weather forecast information. The default Weather Module has an envcanada provider to display Environment Canada data in the MagicMirror² Weather Module. However, Environment Canada provides more information than the default module can display. This module displays the text forecast, the marine wind forecast, and a graphical display of the forecast for day and night. This module does not display current conditions, as the default weather module provides that function very well. Some code from the envcanada provider has been incorporated or modified and incorporated into this module.

## Installation
1. Navigate to the `modules` folder
	```bash
	cd ~/MagicMirror/modules
	```
2. Clone the repository
	```bash
	git clone https://github.com/CharlesMorris78/MMM-EnvCanada.git
	```
3. Add the module to your MagicMirror² by copying the sample configuration below and add that to your `config.js`. No additional npm dependencies need to be installed for this module.

### Update
Update this module by navigating into its folder on the command line and using `git pull`. Restart MagicMirror after updating.

### Server-side Data Migration

Weather, marine forecasts and air quality are now downloaded and parsed by this module's Node helper. The browser receives structured display data only; MagicMirror's `/cors` proxy is no longer used or required. Existing configuration options remain available. Restart MagicMirror after updating; no extra dependencies or Core-CORS configuration are needed for this module. Remove old `dd.weather.gc.ca` Core-CORS whitelist entries only if no other module still needs them.

The helper reads each instance's configuration on the server. Client notifications cannot supply URLs, headers or replacement configuration. Requests are restricted to the HTTPS Datamart host, use a checked public DNS address for the actual connection, reject redirects, and enforce a 30-second total timeout and a 4 MiB response limit. HTTPS certificate verification remains enabled.

Forecast files are selected from validated directory links rather than fixed character offsets. Marine forecasts use the latest available hourly directory today, since not every hour has a forecast. Successfully parsed weather/marine files are cached; failed requests are retried at the next update. Previous successful data remains visible on transient errors. Each instance has separate data and polling state, and server shutdown cancels requests and timers. Intervals below one second are clamped to one second.

Air quality uses Datamart region codes (`atl`, `ont`, `pnr`, `pyr`, `que`), not the weather province codes. The two air quality settings were previously implemented but undocumented.

Fixed interface text is maintained in `translations/en.json` and `translations/fr.json`. The helper selects the texts using each instance's `language`, independently of MagicMirror's global language. Provider text remains in the requested provider language.

The runtime uses Node.js built-ins only, apart from MagicMirror's standard helper/logger APIs. Native `net.isIP` and `net.BlockList` checks reject private and reserved addresses. IPv6 requests are conservatively restricted to global unicast `2000::/3`, excluding reserved/documentation and transition ranges; IPv4-mapped and scoped IPv6 addresses are rejected. The bounded Datamart XML reader handles elements, quoted attributes, text, comments, CDATA and standard/numeric entities. DTDs, external entities, malformed structures and excessive nesting/element counts are rejected. It is not a general-purpose XML parser.

### Testing

```bash
npm test
npm run check
```

Run tests with the module inside an installed MagicMirror checkout. Template tests use Nunjucks, which MagicMirror already requires; no module-specific npm install is necessary.

To run the two-instance English/French demo with the Core proxy disabled, run this from the module directory:

```bash
npm run demo
```

This starts MagicMirror in Electron development mode, like the demo scripts in other modules. For a server-only demo instead:

```bash
npm run demo:server
```

Open `http://localhost:8095` for the server-only demo. Change the demo port if it is already in use. The demo also enables marine and air quality data; these are independent configured locations.

The server/helper integration has been verified with MagicMirror `2.39.0-develop` and Node.js `26.2.0`. Compatibility with older Core versions, particularly their ESM helper-loading behavior, has not been certified. The demo uses the existing desktop mirror-region layout, not a mobile layout.

## Sample Config
Here's an example of a basic config for the module. See full list of available settings below under [Configuration](#configuration)
```javascript
		{
			module: 'MMM-EnvCanada',
			position: 'top_right',
			header: "Environment Canada Forecast for Picton",
			config: {
				siteCode: "s0000702",
				provCode: "ON",
				updateInterval: 10 * 60 * 1000,
				language: "en",
				textForecasts: 2,
				showAlerts: true,
				showForecastDays: 5,
				marineRegion: "great_lakes",
				marineSubRegion: "m0000144",
				marineLocation: "Eastern Lake Ontario"
			}
		},
```

## Configuration
| **Setting** | **Description**|
| --- | --- |
| `header` | Text for the module header. If parameter is not provided, the Environment Canada location text for the configured siteCode is used.<br><br> <ul><li>**Type:** `string`</li><li>**Default:** `Environment Canada location text for the configured siteCode`</li><li>**Possible values:** `Any text string. If set to false, no header will be displayed`</li></ul> |
| `language` | The language of the weather data and module labels: English (en) or French (fr), configured per module instance. Unsupported languages fall back to English.<br><br> <ul><li>**Type:** `string`</li><li>**Default:** `"en"`</li><li>**Possible values:** `"en"` or `"fr"`</li></ul> |
| `airQualityProv` | Datamart air-quality region: `atl`, `ont`, `pnr`, `pyr`, or `que`. Default: `""`. Required when air quality is enabled. |
| `airQualityRegion` | Air-quality station identifier, for example `FAFFD` in `ont`. Default: `""` (disabled). Find identifiers in the region's observation/forecast XML directories at [MSC Datamart](https://dd.weather.gc.ca/today/air_quality/aqhi/). |
| `marineEndMonth` | Final month to display the Marine Forecast.<br><br> <ul><li>**Type:** `number`</li><li>**Default:** `10`</li><li>**Possible values:** 1 through 12</li></ul> |
| `marineLocation` | Location for Marine Forecast. If language is fr (French), must be the French language version of the location.<br><br> <ul><li>**Type:** `string`</li><li>**Default:** `""`</li><li>**Possible values:** see [Environment Canada website](https://weather.gc.ca/marine/index_e.html)</li></ul> |
| `marineRegion` | The region for Marine Forecast. If set to empty string (the default) no Marine Forecast is displayed. Other paramters must be correct or no Marine Forecast will be displayed.<br><br> <ul><li>**Type:** `string`</li><li>**Default:** `""`</li><li>**Possible values:** `"arctic"`, `"atlantic"`, `"great_lakes"`, `"hudson"`, `"mackenzie"`, `"pacific"`, `"prairies"`, `"st_lawrence"`</li></ul> |
| `marineStartMonth` | First month to display the Marine Forecast.<br><br> <ul><li>**Type:** `number`</li><li>**Default:** `5`</li><li>**Possible values:** 1 through 12</li></ul> |
| `marineSubRegion` | The subregion code for Marine Forecast.<br><br> <ul><li>**Type:** `string`</li><li>**Default:** `""`</li><li>**Possible values:** see the Environment Canada document listing all the [sub region codes](https://dd.weather.gc.ca/today/marine_weather/regionList.xml)</li></ul> |
| `provCode` | The 2-character province code for the selected city/town.<br><br> <ul><li>**Type:** `string`</li><li>**Default:** `"ON"`</li><li>**Possible values:** see the Environment Canada document listing all the [siteCode and provCode values for a Canadian city/town](https://dd.weather.gc.ca/today/citypage_weather/siteList.xml)</li></ul> |
| `showAlerts` | Boolean to decide if weather warnings should be included in the forecast text.<br><br> <ul><li>**Type:** `boolean`</li><li>**Default:** `true`</li><li>**Possible values:** `true` or `false`</li></ul> |
| `showforecastDays` | The number of days to display the forecast in graphical format. If less than 3, no graphical forecast is displayed.<br><br> <ul><li>**Type:** `number`</li><li>**Default:** `5`</li><li>**Possible values:** `0` to `6`</li></ul> |
| `siteCode` | The city/town unique identifier for which weather is to be displayed. Format is 's0000000'.<br><br> <ul><li>**Type:** `string`</li><li>**Default:** `"s1234567"` which is not valid. Must be set to a valid entry.</li><li>**Possible values:** see the Environment Canada document listing all the [siteCode and provCode values for a Canadian city/town](https://dd.weather.gc.ca/today/citypage_weather/siteList.xml)</li></ul> |
| `textForecasts` | The number of text forecasts to display. Environment Canada provides two forecasts for each day: today and tonight. If set to 0, no text forecast is displayed.<br><br> <ul><li>**Type:** `number`</li><li>**Default:** `2`</li><li>**Possible values:** `0` to `6`</li></ul> |
| `updateInterval` | The duration of time between each attempt to refresh the forecast information, in miliseconds.<br><br> <ul><li>**Type:** `number`</li><li>**Default:** `10 * 60 * 1000` which is 10 minutes</li></ul> |

## Support
This is my first MagicMirror² module. There probably are better ways to do some of the things I have implemented, but this represents what I have learned so far, with thanks to the authors of the envcanada provider code for the default weather module. I will respond to questions and suggestions as promptly as possible.

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE.md) file for details.

## Changelog
All notable changes to this project will be documented in the [CHANGELOG.md](CHANGELOG.md) file.
