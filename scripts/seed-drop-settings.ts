import { db } from "../src/lib/db";

const rows = [
  {
    key: "forecastDropWindowWeeks",
    value: "8",
    label: "Forecast Drop Window (weeks)",
    description:
      "Number of upcoming weeks summed when comparing the latest Amazon forecast to the previous snapshot.",
  },
  {
    key: "salesVelocityDropAlertPct",
    value: "20",
    label: "Sales Velocity Drop Alert %",
    description:
      "Flag SKU when recent weekly sales velocity falls by >= this % vs. the longer baseline window.",
  },
  {
    key: "salesVelocityDropRecentWeeks",
    value: "4",
    label: "Velocity Drop Recent Window (weeks)",
    description:
      "Length of the recent trailing window used to compute current weekly sales velocity.",
  },
  {
    key: "salesVelocityDropBaselineWeeks",
    value: "13",
    label: "Velocity Drop Baseline Window (weeks)",
    description:
      "Length of the longer trailing window used as baseline weekly sales velocity.",
  },
];

(async () => {
  for (const r of rows) {
    await db.systemSetting.upsert({
      where: { key: r.key },
      update: { label: r.label, description: r.description },
      create: r,
    });
    console.log("upserted", r.key);
  }
  await db.systemSetting.update({
    where: { key: "forecastDropAlertPct" },
    data: {
      description:
        "Flag SKU when Amazon's next-N-week forecast falls by >= this % vs. the previous snapshot.",
    },
  });
  await db.$disconnect();
})();
