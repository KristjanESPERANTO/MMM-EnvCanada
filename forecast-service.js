import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { BlockList, isIP } from "node:net";

const ORIGIN = "https://dd.weather.gc.ca";
const translations = Object.fromEntries(["en", "fr"].map((language) => [
	language, JSON.parse(readFileSync(new URL(`./translations/${language}.json`, import.meta.url), "utf8"))
]));
const blockedIPv4 = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
	["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
	["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
	["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
]) blockedIPv4.addSubnet(network, prefix, "ipv4");
const globalIPv6 = new BlockList();
globalIPv6.addSubnet("2000::", 3, "ipv6");
const blockedIPv6 = new BlockList();
for (const [network, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]]) {
	blockedIPv6.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address) {
	if (typeof address !== "string" || address.includes("%")) return false;
	const family = isIP(address);
	if (family === 4) return !blockedIPv4.check(address, "ipv4");
	return family === 6 && globalIPv6.check(address, "ipv6") && !blockedIPv6.check(address, "ipv6");
}
export const defaults = {
	updateInterval: 10 * 60 * 1000,
	siteCode: "s1234567",
	provCode: "ON",
	language: "en",
	textForecasts: 2,
	showAlerts: true,
	showForecastDays: 5,
	marineRegion: "",
	marineSubRegion: "",
	marineLocation: "",
	marineStartMonth: 5,
	marineEndMonth: 10,
	airQualityProv: "",
	airQualityRegion: ""
};

export function getInstanceConfigs(modules, name) {
	const positions = ["top_bar", "top_left", "top_center", "top_right", "upper_third", "middle_center", "lower_third", "bottom_left", "bottom_center", "bottom_right", "bottom_bar", "fullscreen_above", "fullscreen_below"];
	return modules.filter((module) => module.module !== undefined && (module.position === undefined || positions.includes(module.position)))
		.flatMap((module, index) => !module.disabled && module.module.split("/").at(-1) === name
			? [{ identifier: `module_${index}_${module.module}`, config: module.config ?? {} }] : []);
}

export function validateConfig(input) {
	const config = { ...defaults, ...input };
	const province = /^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/;
	if (!province.test(config.provCode) || !/^s\d{7}$/.test(config.siteCode)) {
		throw new Error("Invalid weather location configuration");
	}
	config.language = config.language === "fr" ? "fr" : "en";
	if (config.marineRegion && (![
		"arctic", "atlantic", "great_lakes", "hudson", "mackenzie", "pacific", "prairies", "st_lawrence"
	].includes(config.marineRegion) || !/^m\d{7}$/.test(config.marineSubRegion))) {
		throw new Error("Invalid marine location configuration");
	}
	if (config.airQualityRegion && (!["atl", "ont", "pnr", "pyr", "que"].includes(config.airQualityProv) || !/^[A-Za-z0-9_-]{1,80}$/.test(config.airQualityRegion))) {
		throw new Error("Invalid air quality location configuration");
	}
	for (const key of ["textForecasts", "showForecastDays", "marineStartMonth", "marineEndMonth", "updateInterval"]) {
		if (!Number.isFinite(config[key])) throw new Error("Invalid numeric configuration");
	}
	config.textForecasts = Math.max(0, Math.min(6, Math.floor(config.textForecasts)));
	config.showForecastDays = Math.max(0, Math.min(6, Math.floor(config.showForecastDays)));
	config.marineStartMonth = Math.max(1, Math.min(12, Math.floor(config.marineStartMonth)));
	config.marineEndMonth = Math.max(1, Math.min(12, Math.floor(config.marineEndMonth)));
	config.updateInterval = Math.max(1000, config.updateInterval);
	return config;
}

export function createDownloader({ lookup = dnsLookup, request = https.get, timeout = 30000, maxBytes = 4 * 1024 * 1024 } = {}) {
	return function download(url, signal) {
		const target = new URL(url);
		if (target.origin !== ORIGIN || target.username || target.password || target.search || target.hash ||
			!/^\/today\/(citypage_weather|marine_weather|air_quality)\/[A-Za-z0-9_./-]+$/.test(target.pathname) ||
			target.pathname.includes("..")) {
			return Promise.reject(new Error("Disallowed weather URL"));
		}
		return new Promise((resolve, reject) => {
			let connection;
			let finished = false;
			const finish = (error, data) => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				signal?.removeEventListener("abort", abort);
				if (error) {
					connection?.destroy();
					reject(error);
				} else resolve(data);
			};
			const abort = () => finish(new Error("Weather request aborted"));
			const timer = setTimeout(() => finish(new Error("Weather request timed out")), timeout);
			signal?.addEventListener("abort", abort, { once: true });
			if (signal?.aborted) return abort();
			Promise.resolve().then(() => lookup(target.hostname, { all: true })).then((addresses) => {
				if (finished) return;
				if (!addresses.length || addresses.some(({ address, family }) => !isPublicAddress(address) || isIP(address) !== family)) {
					throw new Error("Disallowed weather server address");
				}
				const pinned = addresses[0];
				connection = request(target, {
					headers: { "User-Agent": "MMM-EnvCanada", Accept: "application/xml,text/html" },
					agent: false,
					lookup: (_hostname, options, callback) => {
						if (options.all) callback(null, [pinned]);
						else callback(null, pinned.address, pinned.family);
					}
				}, (response) => {
					response.on("error", () => finish(new Error("Weather response failed")));
					if (response.statusCode < 200 || response.statusCode >= 300) {
						response.destroy();
						return finish(new Error("Weather server returned an unsuccessful status"));
					}
					let bytes = 0;
					const chunks = [];
					response.on("data", (chunk) => {
						bytes += chunk.length;
						if (bytes > maxBytes) {
							response.destroy();
							finish(new Error("Weather response too large"));
						} else chunks.push(chunk);
					});
					response.on("end", () => finish(null, Buffer.concat(chunks).toString("utf8")));
					response.on("aborted", () => finish(new Error("Weather response interrupted")));
				});
				connection.on("error", () => finish(new Error("Weather connection failed")));
			}).catch(() => finish(new Error("Weather server lookup or connection failed")));
		});
	};
}

function decodeXmlText(value) {
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(value)) {
		throw new Error("Invalid XML character");
	}
	const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
	return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);|&/gi, (entity, name) => {
		if (!name) throw new Error("Invalid XML entity");
		if (Object.hasOwn(entities, name)) return entities[name];
		if (!/^#(?:x[\da-f]+|\d+)$/i.test(name)) throw new Error("Invalid XML entity");
		const code = name.startsWith("#x") ? parseInt(name.slice(2), 16) : Number(name.slice(1));
		if (![9, 10, 13].includes(code) && !(code >= 0x20 && code <= 0xd7ff) &&
			!(code >= 0xe000 && code <= 0xfffd) && !(code >= 0x10000 && code <= 0x10ffff)) {
			throw new Error("Invalid XML character reference");
		}
		return String.fromCodePoint(code);
	});
}

function directoryLinks(html) {
	const listing = html.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
	const links = [];
	for (const [tag] of listing.matchAll(/<a\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi)) {
		const attributes = tag.slice(2, -1);
		for (const match of attributes.matchAll(/([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
			if (match[1].toLowerCase() !== "href") continue;
			try {
				links.push(decodeXmlText(match[2] ?? match[3] ?? match[4] ?? ""));
			} catch {
				continue;
			}
			break;
		}
	}
	return links;
}

export function findForecastFile(html, directory, code, language, kind) {
	const prefix = kind === "weather" ? "CitypageWeather" : "MarineWeather";
	const pattern = new RegExp(`^\\d{8}T\\d{6}(?:\\.\\d{3})?Z_MSC_${prefix}_${code}_${language}\\.xml$`);
	const files = directoryLinks(html).filter((name) => pattern.test(name)).sort();
	if (!files.length) throw new Error("No matching forecast file");
	return new URL(files.at(-1), directory).href;
}

export function findLatestDirectory(html, base, hour) {
	const hours = directoryLinks(html)
		.filter((name) => /^(0\d|1\d|2[0-3])\/$/.test(name) && name.slice(0, 2) <= hour).sort();
	if (!hours.length) throw new Error("No recent marine directory");
	return new URL(hours.at(-1), base).href;
}

class XmlElement {
	constructor(tagName, attributes = Object.create(null)) {
		this.tagName = tagName;
		this.attributes = attributes;
		this.parts = [];
	}

	get textContent() {
		return this.parts.map((part) => typeof part === "string" ? part : part.textContent).join("");
	}

	getAttribute(name) {
		return this.attributes[name] ?? null;
	}

	querySelectorAll(selector) {
		const descendants = (parent) => parent.parts.filter((part) => part instanceof XmlElement)
			.flatMap((child) => [child, ...descendants(child)]);
		return selector.split(" ").reduce((parents, tagName) => [...new Set(parents
			.flatMap((parent) => descendants(parent).filter((child) => child.tagName === tagName)))], [this]);
	}

	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null;
	}
}

function readXml(source) {
	const xml = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	const document = new XmlElement("");
	const stack = [document];
	const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/[A-Za-z_][\w:.-]*\s*>|<[A-Za-z_][\w:.-]*(?:[^<>"']|"[^"]*"|'[^']*')*>|[^<]+/gy;
	let offset = 0;
	let elements = 0;
	while (offset < xml.length) {
		const match = tokens.exec(xml);
		if (!match || match.index !== offset) throw new Error("Unsupported or malformed XML");
		const token = match[0];
		offset = tokens.lastIndex;
		if (token.startsWith("<!--")) {
			if (token.slice(4, -3).includes("--")) throw new Error("Invalid XML comment");
			continue;
		}
		if (token.startsWith("<?")) continue;
		const parent = stack.at(-1);
		if (token.startsWith("<![CDATA[")) {
			if (stack.length === 1) throw new Error("CDATA outside XML root");
			parent.parts.push(token.slice(9, -3));
		} else if (token.startsWith("</")) {
			if (stack.length === 1 || token.slice(2, -1).trim() !== parent.tagName) throw new Error("Mismatched XML element");
			stack.pop();
		} else if (token.startsWith("<")) {
			if (++elements > 50000 || stack.length > 64) throw new Error("XML structure limit exceeded");
			const [, name, attributeSource, selfClosing] = token.match(/^<([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?)>$/);
			const attributes = Object.create(null);
			const pattern = /\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
			while (pattern.lastIndex < attributeSource.length) {
				const start = pattern.lastIndex;
				if (!attributeSource.slice(start).trim()) break;
				const attributeMatch = pattern.exec(attributeSource);
				if (!attributeMatch || Object.hasOwn(attributes, attributeMatch[1])) throw new Error("Invalid XML attribute");
				const value = attributeMatch[2] ?? attributeMatch[3];
				if (value.includes("<")) throw new Error("Invalid XML attribute value");
				attributes[attributeMatch[1]] = decodeXmlText(value.replace(/[\t\n]/g, " "));
			}
			const element = new XmlElement(name, attributes);
			parent.parts.push(element);
			if (!selfClosing) stack.push(element);
		} else {
			if (stack.length === 1 && token.trim()) throw new Error("Text outside XML root");
			parent.parts.push(decodeXmlText(token));
		}
	}
	const roots = document.parts.filter((part) => part instanceof XmlElement);
	if (stack.length !== 1 || roots.length !== 1) throw new Error("Invalid XML root");
	document.documentElement = roots[0];
	return document;
}

const text = (element, selector) => element.querySelector(selector)?.textContent.trim() ?? "";
const attribute = (element, selector, name) => element.querySelector(selector)?.getAttribute(name) ?? "";
const qualityStatus = (value) => Number(value) > 6 ? "high" : Number(value) > 3 ? "med" : "low";
const icons = [
	"day-sunny", "day-sunny", "day-sunny-overcast", "day-cloudy", "day-cloudy", "day-cloudy", "day-sprinkle", "day-showers", "day-snow", "day-thunderstorm",
	"cloud", "showers", "rain", "rain", "sleet", "sleet", "snow", "snow", "snow", "thunderstorm", "cloudy", "cloudy", "day-cloudy", "day-haze", "fog", "snow-wind", "sleet", "rain", "rain", "na",
	"night-clear", "night-clear", "night-partly-cloudy", "night-alt-cloudy", "night-alt-cloudy", "night-partly-cloudy", "night-alt-showers", "night-rain-mix", "night-alt-snow", "night-thunderstorm",
	"snow-wind", "tornado", "tornado", "windy", "smoke", "sandstorm", "thunderstorm", "thunderstorm", "tornado"
];

export function parseResponse(xml, kind, config) {
	const document = readXml(xml);
	if (kind === "weather") {
		if (document.documentElement.tagName !== "siteData") throw new Error("Invalid weather document");
		const periods = [...document.querySelectorAll("siteData forecastGroup forecast")];
		if (!periods.length) throw new Error("Missing forecast periods");
		const forecasts = periods.slice(0, config.textForecasts).map((period) => ({
			name: attribute(period, "period", "textForecastName"),
			summary: text(period, "textSummary")
		}));
		const alerts = config.showAlerts ? [...document.querySelectorAll("siteData warnings event")]
			.filter((event) => event.getAttribute("type") === "warning")
			.map((event) => event.getAttribute("description") ?? "") : [];
		const days = [];
		const today = config.language === "fr" ? "Aujourd'hui" : "Today";
		let day = { date: today };
		const startsToday = attribute(periods[0], "period", "textForecastName") === today;
		periods.slice(0, 12).forEach((period, index) => {
			const daytime = startsToday ? index % 2 === 0 : index % 2 === 1;
			const prefix = daytime ? "" : "night";
			if (daytime) day.date = attribute(period, "period", "textForecastName");
			const icon = text(period, "abbreviatedForecast iconCode");
			day[prefix ? "nightCondition" : "condition"] = /^\d{1,2}$/.test(icon) ? icons[Number(icon)] ?? null : null;
			const temperature = text(period, "temperatures temperature");
			day[prefix ? "nightTemp" : "temp"] = temperature ? `${temperature}\u00B0` : "";
			const pop = text(period, "abbreviatedForecast pop");
			day[prefix ? "nightPop" : "pop"] = Number(pop) > 0 ? `${pop}%` : pop;
			if (!daytime) {
				days.push(day);
				day = {};
			}
		});
		return { location: text(document, "siteData location name"), forecasts, alerts, days };
	}
	if (kind === "marine") {
		if (document.documentElement.tagName !== "marineData") throw new Error("Invalid marine document");
		const matches = (location) => !location.getAttribute("name") || location.getAttribute("name") === config.marineLocation;
		const warnings = [...document.querySelectorAll("marineData warnings location")].filter(matches)
			.flatMap((location) => [...location.querySelectorAll("event")])
			.filter((event) => ["EN VIGUEUR", "IN EFFECT"].includes(event.getAttribute("status")))
			.map((event) => event.getAttribute("name") ?? "");
		const winds = [...document.querySelectorAll("marineData regularForecast location")].filter(matches)
			.map((location) => text(location, "weatherCondition wind")).filter(Boolean);
		return { marine: { warnings, winds } };
	}
	const observation = kind === "airQuality";
	const root = observation ? "conditionAirQuality" : "forecastAirQuality";
	if (document.documentElement.tagName !== root) throw new Error("Invalid air quality document");
	const value = text(document, observation ? "conditionAirQuality airQualityHealthIndex" : "forecastAirQuality forecastGroup forecast airQualityHealthIndex");
	if (!value) throw new Error("Missing air quality index");
	return observation ? {
		airquality: attribute(document, "conditionAirQuality region", config.language === "fr" ? "nameFr" : "nameEn"),
		airQI: value, airQIStat: qualityStatus(value)
	} : { airQIF: value, airQIFStat: qualityStatus(value) };
}

export class ForecastService {
	constructor(config, onData, onError, { download = createDownloader(), now = () => new Date() } = {}) {
		this.config = validateConfig(config);
		this.onData = onData;
		this.onError = onError;
		this.download = download;
		this.now = now;
		this.data = { labels: translations[this.config.language] };
		this.lastFiles = new Map();
		this.running = false;
		this.controller = new AbortController();
	}

	start() {
		if (this.running || this.controller.signal.aborted) return;
		this.running = true;
		this.refresh();
	}

	stop() {
		this.running = false;
		clearTimeout(this.timer);
		this.controller.abort();
	}

	async refresh() {
		const config = this.config;
		const date = this.now();
		const hour = date.toISOString().substring(11, 13);
		const jobs = [["weather", `${ORIGIN}/today/citypage_weather/${config.provCode}/${hour}/`, config.siteCode]];
		const month = date.getMonth() + 1;
		const inSeason = config.marineStartMonth <= config.marineEndMonth
			? month >= config.marineStartMonth && month <= config.marineEndMonth
			: month >= config.marineStartMonth || month <= config.marineEndMonth;
		if (config.marineRegion && inSeason) {
			jobs.push(["marine", `${ORIGIN}/today/marine_weather/${config.marineRegion}/`, config.marineSubRegion]);
		} else this.data.marine = { warnings: [], winds: [] };
		if (config.airQualityRegion) {
			const base = `${ORIGIN}/today/air_quality/aqhi/${config.airQualityProv}`;
			jobs.push(["airQuality", `${base}/observation/realtime/xml/AQ_OBS_${config.airQualityRegion}_CURRENT.xml`]);
			jobs.push(["airQualityForecast", `${base}/forecast/realtime/xml/AQ_FCST_${config.airQualityRegion}_CURRENT.xml`]);
		}
		await Promise.all(jobs.map(async ([kind, url, code]) => {
			try {
				let body = await this.download(url, this.controller.signal);
				if (kind === "marine") {
					url = findLatestDirectory(body, url, hour);
					body = await this.download(url, this.controller.signal);
				}
				let file;
				if (code) {
					file = findForecastFile(body, url, code, config.language, kind);
					if (date.toISOString().slice(0, 13) !== this.now().toISOString().slice(0, 13)) return;
					if (this.lastFiles.get(kind) === file) {
						if (this.errors) delete this.errors[kind];
						return;
					}
					body = await this.download(file, this.controller.signal);
				}
				const result = parseResponse(body, kind, config);
				if (this.controller.signal.aborted) return;
				if (file) this.lastFiles.set(kind, file);
				Object.assign(this.data, result);
				if (this.errors) delete this.errors[kind];
				this.onData(this.data);
			} catch {
				if (!this.controller.signal.aborted) this.onError(kind);
			}
		}));
		if (!this.controller.signal.aborted) this.onData(this.data);
		if (this.running) this.timer = setTimeout(() => this.refresh(), config.updateInterval);
	}
}
