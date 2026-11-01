module.exports = {
	address: "localhost",
	port: 8096,
	ipWhitelist: ["127.0.0.1", "::1", "::ffff:127.0.0.1"],
	cors: "disabled",
	language: "en",
	modules: [
		{
			module: "MMM-EnvCanada",
			position: "top_left",
			config: {
				siteCode: "s0000702",
				provCode: "ON",
				marineRegion: "great_lakes",
				marineSubRegion: "m0000097",
				marineEndMonth: 12,
				airQualityProv: "ont",
				airQualityRegion: "FAFFD"
			}
		},
		{
			module: "MMM-EnvCanada",
			position: "top_right",
			config: { siteCode: "s0000027", provCode: "QC", language: "fr" }
		}
	]
};
