import { createRequire } from "node:module";
import { ForecastService, getInstanceConfigs } from "./forecast-service.js";

const require = createRequire(import.meta.url);
const NodeHelper = require("node_helper");
const Log = require("logger");

export default NodeHelper.create({
	start() {
		this.services = new Map();
		this.invalidInstances = new Set();
		for (const { identifier, config } of getInstanceConfigs(global.config?.modules ?? [], this.name)) {
			try {
				const errors = {};
				const service = new ForecastService(config, (data) => {
					this.sendSocketNotification("ENVCANADA_DATA", { identifier, data, errors: { ...errors } });
				}, (kind) => {
					errors[kind] = true;
					Log.warn(`[MMM-EnvCanada] ${identifier}: ${kind} update failed`);
					this.sendSocketNotification("ENVCANADA_ERROR", { identifier, kind });
				});
				service.errors = errors;
				this.services.set(identifier, service);
			} catch {
				this.invalidInstances.add(identifier);
				Log.error(`[MMM-EnvCanada] ${identifier}: invalid server configuration`);
			}
		}
	},

	socketNotificationReceived(notification, payload) {
		if (notification !== "ENVCANADA_SUBSCRIBE" || typeof payload?.identifier !== "string") return;
		const identifier = payload.identifier;
		if (this.invalidInstances.has(identifier)) {
			this.sendSocketNotification("ENVCANADA_ERROR", { identifier, kind: "configuration" });
			return;
		}
		const service = this.services.get(identifier);
		if (!service) return;
		if (Object.keys(service.data).length) {
			this.sendSocketNotification("ENVCANADA_DATA", { identifier, data: service.data, errors: { ...service.errors } });
		}
		service.start();
	},

	stop() {
		for (const service of this.services?.values() ?? []) service.stop();
	}
});