/**
 * Regenerate data/sample-students.csv.
 *
 *   npm run gen:sample
 *
 * Identity commitments are computed with the same Poseidon code the app uses,
 * via the transpiled lib in .tmp (see the "compile" npm script).
 */

const fs = require("fs");
const path = require("path");

const {
  computeIdentityCommitment,
  deriveDemoIdentitySecret,
} = require("../.tmp/credential.js");

/**
 * Deliberate spread so the demo can show both outcomes against a
 * "CGPA >= 8.0, B.Tech CSE" request:
 *   - 15 students clear 8.00
 *   -  5 fall below it (proof generation must fail)
 *   -  2 clear 8.00 but hold a different degree (attribute constraint fails)
 */
const ROSTER = [
  ["Aarav Sharma", "BTECH/27431/23", 8.34, 1101, 2027],
  ["Diya Nair", "BTECH/27102/23", 9.12, 1101, 2027],
  ["Rohan Verma", "BTECH/27218/23", 8.76, 1101, 2027],
  ["Ananya Iyer", "BTECH/27355/23", 8.05, 1101, 2027],
  ["Kabir Singh", "BTECH/27467/23", 9.41, 1101, 2027],
  ["Ishita Banerjee", "BTECH/27523/23", 8.62, 1101, 2027],
  ["Vivaan Patel", "BTECH/27614/23", 8.19, 1101, 2027],
  ["Meera Krishnan", "BTECH/27689/23", 8.93, 1101, 2027],
  ["Arjun Reddy", "BTECH/27741/23", 8.47, 1101, 2027],
  ["Saanvi Gupta", "BTECH/27806/23", 8.28, 1101, 2027],
  ["Aditya Bose", "BTECH/27877/23", 9.05, 1101, 2027],
  ["Neha Chauhan", "BTECH/27912/23", 8.51, 1101, 2027],
  ["Rishi Menon", "BTECH/27964/23", 8.11, 1101, 2027],
  ["Karan Malhotra", "BTECH/27155/23", 6.4, 1101, 2027],
  ["Priya Deshmukh", "BTECH/27283/23", 7.82, 1101, 2027],
  ["Sameer Joshi", "BTECH/27398/23", 7.15, 1101, 2027],
  ["Tanvi Rao", "BTECH/27446/23", 6.95, 1102, 2027],
  ["Aryan Mishra", "BTECH/27572/23", 7.6, 1102, 2027],
  ["Nikhil Pillai", "BTECH/27633/23", 9.2, 1102, 2027],
  ["Shreya Kulkarni", "MTECH/27058/23", 8.88, 1201, 2027],
];

const header = [
  "# BIT Mesra — graduating batch intake, 2027-SPRING",
  "# identityCommitment = Poseidon(identitySecret, IDENTITY_DOMAIN).",
  "# In a real deployment the student generates identitySecret at registration",
  "# and registers only this commitment; the university never sees the secret.",
  "name,rollNumber,identityCommitment,cgpa,degreeCode,year",
];

const rows = ROSTER.map(([name, rollNumber, cgpa, degreeCode, year]) => {
  const commitment = computeIdentityCommitment(
    deriveDemoIdentitySecret(rollNumber),
  );
  return [name, rollNumber, commitment, cgpa.toFixed(2), degreeCode, year].join(
    ",",
  );
});

const outPath = path.join(__dirname, "..", "data", "sample-students.csv");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, header.concat(rows).join("\n") + "\n", "utf8");

const above = ROSTER.filter((r) => r[2] >= 8.0).length;
console.log(
  "Wrote " +
    rows.length +
    " students to data/sample-students.csv (" +
    above +
    " at or above CGPA 8.00, " +
    (ROSTER.length - above) +
    " below).",
);
