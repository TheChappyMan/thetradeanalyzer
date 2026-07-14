import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/settings",
          "/history",
          "/commissioner",
          "/payment-success",
          "/api/",
        ],
      },
    ],
    sitemap: "https://app.thetradeanalyzer.com/sitemap.xml",
  };
}
