import type { MetadataRoute } from "next";

const BASE = "https://app.thetradeanalyzer.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`,    changeFrequency: "weekly", priority: 1.0 },
    { url: `${BASE}/nhl`, changeFrequency: "daily",  priority: 0.9 },
    { url: `${BASE}/nfl`, changeFrequency: "daily",  priority: 0.9 },
    { url: `${BASE}/mlb`, changeFrequency: "daily",  priority: 0.9 },
  ];
}
