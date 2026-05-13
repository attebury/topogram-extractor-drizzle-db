const manifest = require("./topogram-extractor.json");

const drizzleExtractor = {
  id: "db.drizzle-package",
  track: "db",
  detect() {
    return { score: 0, reasons: [] };
  },
  extract() {
    return {
      findings: [],
      candidates: {
        entities: [],
        enums: [],
        relations: [],
        indexes: [],
        maintained_seams: []
      },
      diagnostics: []
    };
  }
};

module.exports = {
  manifest,
  extractors: [drizzleExtractor]
};

