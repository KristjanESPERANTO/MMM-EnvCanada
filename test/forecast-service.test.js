import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import Module from "node:module";
import nunjucks from "nunjucks";
import test from "node:test";
import { createDownloader, findForecastFile, findLatestDirectory, ForecastService, getInstanceConfigs, isPublicAddress, parseResponse, validateConfig } from "../forecast-service.js";

const directory = "https://dd.weather.gc.ca/today/citypage_weather/ON/12/";
const config = validateConfig({ siteCode: "s0000702" });

test("selects latest exact filename, rejects foreign links and supports French", () => {
	const names = ["20261031T120000.000Z", "20261031T121000.413Z"];
	const html = names.map((name) => `<a href="${name}_MSC_CitypageWeather_s0000702_fr.xml">file</a>`).join("") +
		'<a href="https://evil.test/20261031T125000Z_MSC_CitypageWeather_s0000702_fr.xml">bad</a>';
	assert.equal(findForecastFile(html, directory, config.siteCode, "fr", "weather"), `${directory}${names[1]}_MSC_CitypageWeather_s0000702_fr.xml`);
	assert.throws(() => findForecastFile(html, directory, config.siteCode, "en", "weather"));
});

test("parses real XML case, entities, warnings and separate day/night values", () => {
	const period = (name, temp, icon) => `<forecast><period textForecastName="${name}"/><textSummary>Cloud &amp; rain</textSummary><temperatures><temperature>${temp}</temperature></temperatures><abbreviatedForecast><iconCode>${icon}</iconCode><pop>40</pop></abbreviatedForecast></forecast>`;
	const result = parseResponse(`<siteData><location><name>Picton</name></location><warnings><event type="warning" description="Wind"/></warnings><forecastGroup>${period("Today", 10, "00")}${period("Tonight", 2, "30")}</forecastGroup></siteData>`, "weather", config);
	assert.equal(result.forecasts[0].summary, "Cloud & rain");
	assert.deepEqual(result.alerts, ["Wind"]);
	assert.equal(result.days[0].temp, "10\u00B0");
	assert.equal(result.days[0].nightCondition, "night-clear");
	assert.throws(() => parseResponse('<!DOCTYPE siteData><siteData/>', "weather", config));
});

test("validates configured path parameters", () => {
	for (const input of [{ provCode: "../ON" }, { siteCode: "s0000702.*" }, { marineRegion: "evil" }, { airQualityRegion: "../secret", airQualityProv: "ON" }]) {
		assert.throws(() => validateConfig(input));
	}
});

function transport(status = 200, body = "data") {
	const calls = [];
	const request = (url, options, callback) => {
		calls.push({ url, options });
		const connection = new EventEmitter();
		connection.destroy = () => {};
		queueMicrotask(() => {
			const response = new PassThrough();
			response.statusCode = status;
			callback(response);
			response.end(body);
		});
		return connection;
	};
	return { calls, request };
}

test("pins public DNS address and refuses redirects, private DNS, arbitrary URLs and oversized bodies", async () => {
	const mock = transport();
	const lookup = async () => [{ address: "8.8.8.8", family: 4 }];
	assert.equal(await createDownloader({ lookup, request: mock.request })(directory), "data");
	mock.calls[0].options.lookup("dd.weather.gc.ca", {}, (error, address) => {
		assert.equal(error, null);
		assert.equal(address, "8.8.8.8");
	});
	await assert.rejects(createDownloader({ lookup, request: transport(302).request })(directory));
	for (const address of ["127.0.0.1", "10.1.2.3", "::1", "::ffff:192.168.1.1"]) {
		await assert.rejects(createDownloader({ lookup: async () => [{ address, family: 4 }], request: mock.request })(directory));
	}
	await assert.rejects(createDownloader({ lookup, request: mock.request })("https://evil.test/today/citypage_weather/ON/12/"));
	await assert.rejects(createDownloader({ lookup, request: mock.request, maxBytes: 2 })(directory));
});

test("timeout covers DNS and abort prevents a connection", async () => {
	await assert.rejects(createDownloader({ lookup: () => new Promise(() => {}), timeout: 5 })(directory), /timed out/);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(createDownloader()(directory, controller.signal), /aborted/);
});

test("native IP checks reject private, reserved, mapped and scoped addresses", () => {
	for (const address of ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888", "2606:4700:4700::1111"]) {
		assert.equal(isPublicAddress(address), true, address);
	}
	for (const address of [
		"not-an-ip", "0.1.2.3", "10.0.0.1", "100.64.0.1", "100.127.255.255", "127.1.2.3",
		"169.254.1.2", "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.0.2.1", "192.88.99.1",
		"192.168.1.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1",
		"224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255", "::", "::1",
		"::ffff:8.8.8.8", "::ffff:192.168.1.1", "fc00::1", "fe80::1", "ff02::1",
		"2001::1", "2001:db8::1", "2002:0808:0808::1", "3fff::1", "2001:4860::1%eth0"
	]) assert.equal(isPublicAddress(address), false, address);
});

test("selects latest available marine hour without accepting foreign paths", () => {
	const base = "https://dd.weather.gc.ca/today/marine_weather/great_lakes/";
	assert.equal(findLatestDirectory('<a href="14/"/><a href="15/"/><a href="23/"/><a href="../16/"/>', base, "16"), `${base}15/`);
});

test("keeps server configurations separate and matches the core instance identifiers", () => {
	const modules = [{ module: "clock", position: "top_left" }, { module: "invalid", position: "unknown" },
		{ module: "MMM-EnvCanada", config: { siteCode: "s0000702" } },
		{ module: "MMM-EnvCanada", disabled: true },
		{ module: "MMM-EnvCanada", config: { siteCode: "s0000458", language: "fr" } }];
	const instances = getInstanceConfigs(modules, "MMM-EnvCanada");
	assert.deepEqual(instances.map(({ identifier }) => identifier), ["module_1_MMM-EnvCanada", "module_3_MMM-EnvCanada"]);
	assert.equal(instances[1].config.language, "fr");
});

test("preserves marine location filtering and localized air quality", () => {
	const cfg = validateConfig({ language: "fr", airQualityProv: "ont", airQualityRegion: "FAFFD", marineLocation: "Lac" });
	const marine = parseResponse('<marineData><warnings><location name="Lac"><event status="EN VIGUEUR" name="Vent"/></location><location name="Other"><event status="IN EFFECT" name="Wrong"/></location></warnings><regularForecast><location name="Lac"><weatherCondition><wind>Nord 10</wind></weatherCondition></location></regularForecast></marineData>', "marine", cfg);
	assert.deepEqual(marine.marine, { warnings: ["Vent"], winds: ["Nord 10"] });
	assert.deepEqual(parseResponse('<conditionAirQuality><region nameEn="Town" nameFr="Ville"/><airQualityHealthIndex>7</airQualityHealthIndex></conditionAirQuality>', "airQuality", cfg), { airquality: "Ville", airQI: "7", airQIStat: "high" });
	assert.deepEqual(parseResponse('<forecastAirQuality><forecastGroup><forecast><airQualityHealthIndex>4</airQualityHealthIndex></forecast></forecastGroup></forecastAirQuality>', "airQualityForecast", cfg), { airQIF: "4", airQIFStat: "med" });
});

test("retries failed XML, caches only successful files and cleans up timers", async () => {
	const name = "20261031T120000.000Z_MSC_CitypageWeather_s0000702_en.xml";
	let requests = 0;
	let fail = true;
	const errors = [];
	const service = new ForecastService(config, () => {}, (kind) => errors.push(kind), {
		now: () => new Date("2026-10-31T12:30:00Z"),
		download: async (url) => {
			if (url.endsWith("/")) return `<a href="${name}">file</a>`;
			requests++;
			if (fail) throw new Error("secret value must not escape");
			return '<siteData><location><name>Picton</name></location><forecastGroup><forecast><period textForecastName="Tonight"/><textSummary>Clear</textSummary></forecast></forecastGroup></siteData>';
		}
	});
	await service.refresh();
	assert.deepEqual(errors, ["weather"]);
	fail = false;
	await service.refresh();
	await service.refresh();
	assert.equal(requests, 2);
	assert.equal(service.data.location, "Picton");
	service.start();
	service.start();
	service.stop();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(service.running, false);
	assert.equal(service.controller.signal.aborted, true);
	assert.equal(service.timer, undefined);
});

test("frontend has no HTTP requests, separates instances and escapes provider markup", () => {
	let definition;
	const source = readFileSync(new URL("../MMM-EnvCanada.js", import.meta.url), "utf8");
	const document = { createElement: () => ({
		textContent: "",
		get innerHTML() { return this.textContent.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
	}) };
	vm.runInNewContext(source, { document, Module: { register: (_name, module) => { definition = module; } } });
	const makeInstance = (identifier) => {
		const instance = { ...definition, identifier, data: {}, config: { ...definition.defaults },
			sendSocketNotification: (notification, payload) => {
				assert.equal(notification, "ENVCANADA_SUBSCRIBE");
				assert.deepEqual(Object.keys(payload), ["identifier"]);
			}, updateDom: () => {} };
		instance.start();
		return instance;
	};
	const first = makeInstance("module_0_MMM-EnvCanada");
	const second = makeInstance("module_1_MMM-EnvCanada");
	const labels = JSON.parse(readFileSync(new URL("../translations/en.json", import.meta.url), "utf8"));
	const payload = { identifier: first.identifier, data: { labels, location: "Picton", forecasts: [{ name: "Today", summary: '<img src=x onerror="alert(1)">' }], days: [{ date: "Today" }] } };
	first.socketNotificationReceived("ENVCANADA_DATA", payload);
	second.socketNotificationReceived("ENVCANADA_DATA", payload);
	assert.equal(first.loaded, true);
	assert.equal(second.loaded, false);
	assert.equal(second.weather.forecasts.length, 0);
	first.data.header = false;
	assert.equal(first.getHeader(), "");
	first.data.header = undefined;
	first.weather.location = "<img src=x onerror=alert(1)>";
	assert.ok(first.getHeader().includes("&lt;img"));
	assert.ok(!first.getHeader().includes("<img"));
	const template = readFileSync(new URL("../MMM-EnvCanada.njk", import.meta.url), "utf8");
	const environment = new nunjucks.Environment(null, { autoescape: true });
	const html = environment.renderString(template, first.getTemplateData());
	assert.ok(html.includes("&lt;img"));
	assert.ok(!html.includes("<img"));
	first.config.textForecasts = 0;
	first.socketNotificationReceived("ENVCANADA_DATA", { ...payload, data: { ...payload.data, forecasts: [] } });
	assert.equal(first.loaded, true);
	assert.ok(!/\bfetch\s*\(|\/cors\b/.test(source));
});

test("Datamart XML reader supports CDATA, quoted attributes, numeric entities and comments", () => {
	const xml = `<?xml version="1.0"?><siteData xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
		<!-- <location><name>Wrong</name></location> -->
		<location><name>Saint-&#xC9;tienne &#38; Town</name></location>
		<forecastGroup><forecast><period textForecastName='Tonight' note="a > b"/>
		<textSummary><![CDATA[Cloud < rain & snow]]></textSummary></forecast></forecastGroup></siteData>`;
	const result = parseResponse(xml, "weather", config);
	assert.equal(result.location, "Saint-\u00c9tienne & Town");
	assert.equal(result.forecasts[0].name, "Tonight");
	assert.equal(result.forecasts[0].summary, "Cloud < rain & snow");
});

test("Datamart XML reader refuses malformed structures, external entities and excessive nesting", () => {
	for (const xml of [
		'<siteData><forecastGroup></siteData>', '<siteData/><siteData/>', '<siteData name="a" name="b"/>',
		'<!DOCTYPE siteData [<!ENTITY secret SYSTEM "file:///etc/passwd">]><siteData>&secret;</siteData>',
		'<siteData><name>&unknown;</name></siteData>', '<siteData><name>&#0;</name></siteData>',
		'<siteData><name>&#xD800;</name></siteData>', '<siteData><name>&#x110000;</name></siteData>',
		'<siteData><name>unescaped & text</name></siteData>', '<siteData><name><![CDATA[unfinished</name></siteData>',
		'<siteData>' + '<nested>'.repeat(65) + '</nested>'.repeat(65) + '</siteData>'
	]) assert.throws(() => parseResponse(xml, "weather", config), xml);
});

test("directory reader ignores fake links in comments, scripts and attribute values", () => {
	const filename = "20261031T120000.000Z_MSC_CitypageWeather_s0000702_en.xml";
	const fake = "20261031T125959.000Z_MSC_CitypageWeather_s0000702_en.xml";
	const html = `<!-- <a href="${fake}"> --> <script>const link='<a href="${fake}">';</script>
		<a title=" href='${fake}'" HREF='${filename}'>real</a>`;
	assert.equal(findForecastFile(html, directory, config.siteCode, "en", "weather"), directory + filename);
});

test("language files have matching keys and remain independent per instance", () => {
	const english = new ForecastService({ language: "en" }, () => {}, () => {});
	const french = new ForecastService({ language: "fr" }, () => {}, () => {});
	try {
		assert.deepEqual(Object.keys(english.data.labels).sort(), Object.keys(french.data.labels).sort());
		assert.equal(english.data.labels.FORECAST_FOR, "Forecast for");
		assert.equal(french.data.labels.FORECAST_FOR, "Pr\u00e9visions pour");
		const environment = new nunjucks.Environment(null, { autoescape: true });
		const template = readFileSync(new URL("../MMM-EnvCanada.njk", import.meta.url), "utf8");
		const data = { loaded: false, marine: { warnings: [], winds: [] }, airquality: "", forecastDays: 0 };
		assert.ok(environment.renderString(template, { ...data, labels: english.data.labels }).includes("Loading..."));
		assert.ok(environment.renderString(template, { ...data, labels: french.data.labels }).includes("Chargement..."));
		assert.ok(!/\blanguage\b/.test(template));
	} finally {
		english.stop();
		french.stop();
	}
});

test("helper ignores client URLs/configuration and unknown instances, caches subscriptions and stops services", async () => {
	const originalLoad = Module._load;
	const originalConfig = global.config;
	const logs = [];
	Module._load = function(name, ...args) {
		if (name === "node_helper") return { create: (definition) => class { constructor() { Object.assign(this, definition); } } };
		if (name === "logger") return { warn: (message) => logs.push(message), error: (message) => logs.push(message) };
		return originalLoad.call(this, name, ...args);
	};
	let Helper;
	try {
		({ default: Helper } = await import("../node_helper.js"));
	} finally {
		Module._load = originalLoad;
	}
	const helper = new Helper();
	const messages = [];
	helper.name = "MMM-EnvCanada";
	helper.sendSocketNotification = (notification, payload) => messages.push({ notification, payload });
	try {
		global.config = { modules: [{ module: "MMM-EnvCanada", config: { siteCode: "s0000702", SECRET_UNUSED: "private-value" } },
			{ module: "MMM-EnvCanada", config: { siteCode: "s0000458", language: "fr" } }] };
		helper.start();
		const first = helper.services.get("module_0_MMM-EnvCanada");
		const second = helper.services.get("module_1_MMM-EnvCanada");
		let starts = 0;
		first.refresh = async () => { starts++; };
		second.refresh = async () => { throw new Error("Unsubscribed instance must not fetch"); };
		for (const notification of ["CONFIG", "FETCH", "ENVCANADA_SUBSCRIBE"]) {
			helper.socketNotificationReceived(notification, { identifier: "unknown", url: "http://127.0.0.1/", config: { siteCode: "bad" } });
		}
		assert.equal(starts, 0);
		const payload = { identifier: "module_0_MMM-EnvCanada", url: "http://127.0.0.1/", config: { siteCode: "bad" }, headers: { Authorization: "secret" } };
		helper.socketNotificationReceived("ENVCANADA_SUBSCRIBE", payload);
		helper.socketNotificationReceived("ENVCANADA_SUBSCRIBE", payload);
		assert.equal(starts, 1);
		assert.equal(first.config.siteCode, "s0000702");
		assert.equal(second.running, false);
		first.data = { location: "Picton" };
		helper.socketNotificationReceived("ENVCANADA_SUBSCRIBE", payload);
		assert.equal(messages.at(-1).payload.data.location, "Picton");
		assert.ok(!JSON.stringify(messages).includes("private-value"));
		assert.ok(!JSON.stringify(logs).includes("private-value"));
	} finally {
		helper.stop();
		global.config = originalConfig;
	}
	assert.ok([...helper.services.values()].every((service) => service.controller.signal.aborted));
});

test("partial errors keep good data and stale hourly listings never fetch XML", async () => {
	const errors = [];
	const cfg = { ...config, airQualityProv: "ont", airQualityRegion: "FAFFD" };
	const service = new ForecastService(cfg, () => {}, (kind) => errors.push(kind), {
		now: () => new Date("2026-10-31T12:30:00Z"),
		download: async (url) => {
			if (url.includes("observation")) return '<conditionAirQuality><region nameEn="Barrie"/><airQualityHealthIndex>2</airQualityHealthIndex></conditionAirQuality>';
			throw new Error("upstream unavailable");
		}
	});
	await service.refresh();
	assert.equal(service.data.airQI, "2");
	assert.deepEqual(errors.sort(), ["airQualityForecast", "weather"]);
	service.stop();
	let clockReads = 0;
	let xmlRequests = 0;
	const stale = new ForecastService(config, () => {}, () => {}, {
		now: () => new Date(clockReads++ ? "2026-10-31T13:00:00Z" : "2026-10-31T12:59:59Z"),
		download: async (url) => {
			if (!url.endsWith("/")) xmlRequests++;
			return '<a href="20261031T120000.000Z_MSC_CitypageWeather_s0000702_en.xml">file</a>';
		}
	});
	await stale.refresh();
	assert.equal(xmlRequests, 0);
	stale.stop();
});
