import { spawn } from "child_process";

const configs = [
  "config1.js"
];

for (const cfg of configs) {
  console.log(`🚀 Launching bot for ${cfg}`);

  // 1) Run scanner
  spawn(
    "node",
    ["scannerGeneric.js", cfg],
    { stdio: "inherit" }
  );

  // 2) Start trader immediately after short delay
  setTimeout(() => {
    spawn(
      "node",
      ["paperTesterLogging.js", cfg],
      { stdio: "inherit" }
    );
  }, 3000); // give scanner time to write output
}
