Module.register("MMM-EnvCanada", {
	defaults: {
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
	},

	start() {
		this.weather = {
			labels: {},
			forecasts: [], alerts: [], days: [],
			marine: { warnings: [], winds: [] },
			airquality: "", airQI: "", airQIF: "", airQIStat: "low", airQIFStat: "low"
		};
		this.errors = {};
		this.loaded = false;
		this.config.language = this.config.language === "fr" ? "fr" : "en";
		this.sendSocketNotification("ENVCANADA_SUBSCRIBE", { identifier: this.identifier });
	},

	socketNotificationReceived(notification, payload) {
		if (!payload || payload.identifier !== this.identifier) return;
		if (notification === "ENVCANADA_DATA") {
			Object.assign(this.weather, payload.data);
			this.errors = payload.errors || {};
			this.loaded = this.weather.days.length > 0;
			this.updateDom(0);
		} else if (notification === "ENVCANADA_ERROR") {
			this.errors[payload.kind] = true;
			this.updateDom(0);
		}
	},

	getStyles() {
		return ["weather-icons.css", "MMM-EnvCanada.css"];
	},

	getTemplate() {
		return "MMM-EnvCanada.njk";
	},

	getTemplateData() {
		return {
			...this.weather,
			forecastDays: Math.max(0, Math.min(6, this.config.showForecastDays)),
			forecast: this.weather.days,
			loaded: this.loaded,
			hasError: Object.keys(this.errors).length > 0
		};
	},

	getHeader() {
		if (this.data.header === false || this.data.header === "false") return "";
		if (this.data.header) return this.data.header;
		const location = this.weather?.location;
		if (!location) return "";
		const label = document.createElement("span");
		label.textContent = location;
		return `${this.weather.labels.FORECAST_FOR} ${label.innerHTML}`;
	}
});
