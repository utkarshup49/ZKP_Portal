/**
 * Credential types, commitment construction and the bundle format the
 * university hands to a student.
 *
 * The commitment is
 *
 *   leaf = Poseidon(identityCommitment, cgpaInt, degreeCode, year, institutionId, r)
 *
 * where `r` is a 256-bit blinding factor unique to that student. Without `r`,
 * anyone holding a published leaf could brute-force the small space of
 * (cgpa, degree, year) and recover the credential; `r` is what makes the leaf
 * hiding as well as binding.
 */

import {
  poseidonHash,
  randomFieldHex,
  stringToField,
  toField,
  toHex,
  type FieldLike,
} from "./poseidon";

/* ------------------------------------------------------------------ */
/* Domain constants                                                    */
/* ------------------------------------------------------------------ */

export const ISSUER_ID = "BITM";
export const ISSUER_NAME = "Birla Institute of Technology, Mesra";

/** Field-element form of the issuer id, bound into every leaf. */
export const INSTITUTION_ID = toHex(stringToField("institution:" + ISSUER_ID));

/**
 * Domain separator for identity commitments:
 * identityCommitment = Poseidon(identitySecret, IDENTITY_DOMAIN).
 */
export const IDENTITY_DOMAIN = stringToField("zk-credentials/v1/identity");

/** Domain separator for nullifiers: nullifier = Poseidon(identitySecret, nonce, DOMAIN). */
export const NULLIFIER_DOMAIN = stringToField("zk-credentials/v1/nullifier");

export const DEGREE_CODES: Record<number, string> = {
  1101: "B.Tech CSE",
  1102: "B.Tech ECE",
  1201: "M.Tech CSE",
};

export function degreeName(code: number): string {
  return DEGREE_CODES[code] ?? "Unknown programme (" + code + ")";
}

/* ------------------------------------------------------------------ */
/* CGPA fixed-point encoding                                           */
/* ------------------------------------------------------------------ */

/**
 * Circuits compare integers, not floats. CGPA is carried through the whole
 * system as cgpaInt = round(cgpa * 100) — 8.34 becomes 834.
 */
export function cgpaToInt(cgpa: number): number {
  if (!Number.isFinite(cgpa) || cgpa < 0 || cgpa > 10) {
    throw new Error("cgpaToInt: CGPA " + cgpa + " is outside the range 0-10");
  }
  return Math.round(cgpa * 100);
}

export function intToCgpa(cgpaInt: number): number {
  return cgpaInt / 100;
}

export function formatCgpa(cgpaInt: number): string {
  return intToCgpa(cgpaInt).toFixed(2);
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** One row of the university's intake CSV. */
export interface StudentRecord {
  name: string;
  rollNumber: string;
  identityCommitment: string;
  cgpa: number;
  degreeCode: number;
  year: number;
}

/** A student record after the university has assigned `r` and computed a leaf. */
export interface IssuedCredential extends StudentRecord {
  cgpaInt: number;
  institutionId: string;
  /** 256-bit blinding factor — secret, travels only inside the bundle. */
  r: string;
  leaf: string;
  leafIndex: number;
}

/** The private fields a proof is built from. */
export interface CredentialFields {
  name: string;
  rollNumber: string;
  identityCommitment: string;
  cgpaInt: number;
  degreeCode: number;
  year: number;
  institutionId: string;
}

/**
 * The `.json` file a student downloads. Everything under `credential` and
 * `secrets` is private and must never reach an API route.
 */
export interface CredentialBundle {
  version: string;
  issuer: { id: string; name: string };
  semesterId: string;
  credential: CredentialFields;
  secrets: {
    /** Blinding factor for the leaf commitment. */
    r: string;
    /**
     * DEMO SIMPLIFICATION: the university ships a derivable identity secret so
     * the walkthrough has no registration step. In a real deployment the
     * student generates `identitySecret` in their wallet at registration and
     * sends only Poseidon(identitySecret, IDENTITY_DOMAIN) to the university,
     * which never learns the secret itself.
     */
    identitySecret: string;
  };
  merkle: {
    leaf: string;
    leafIndex: number;
    pathElements: string[];
    pathIndices: number[];
    root: string;
    depth: number;
    leafCount: number;
  };
}

/** What the employer asks the student to prove. Fully public. */
export interface VerificationRequest {
  requestId: string;
  verifierName: string;
  /** Threshold in cgpaInt units (8.0 becomes 800). */
  threshold: number;
  requiredDegreeCode: number;
  minYear: number;
  maxYear: number;
  /** Fresh 128-bit value, one per verification session. */
  nonce: string;
  issuedAt: string;
}

/* ------------------------------------------------------------------ */
/* Commitments                                                         */
/* ------------------------------------------------------------------ */

/**
 * Identity commitment from an identity secret. The student proves knowledge of
 * the preimage inside the circuit, which is what binds a credential to a
 * person rather than to whoever happens to hold the file.
 */
export function computeIdentityCommitment(identitySecret: FieldLike): string {
  return toHex(poseidonHash([identitySecret, IDENTITY_DOMAIN]));
}

/**
 * DEMO ONLY — deterministically derive a student's identity secret from their
 * roll number, so the sample CSV, the issued bundle and the wallet all agree
 * without a registration flow.
 *
 * In production this function does not exist: the secret is generated with
 * crypto.getRandomValues in the wallet and never leaves the device.
 */
export function deriveDemoIdentitySecret(rollNumber: string): string {
  return toHex(stringToField("demo-identity-secret:" + rollNumber));
}

/** leaf = Poseidon(identityCommitment, cgpaInt, degreeCode, year, institutionId, r) */
export function computeLeaf(fields: CredentialFields, r: FieldLike): string {
  return toHex(
    poseidonHash([
      fields.identityCommitment,
      fields.cgpaInt,
      fields.degreeCode,
      fields.year,
      fields.institutionId,
      r,
    ]),
  );
}

/** nullifier = Poseidon(identitySecret, nonce, NULLIFIER_DOMAIN) */
export function computeNullifier(
  identitySecret: FieldLike,
  nonce: FieldLike,
): string {
  return toHex(poseidonHash([identitySecret, nonce, NULLIFIER_DOMAIN]));
}

/** Fresh 256-bit blinding factor. */
export function randomBlindingFactor(): string {
  return randomFieldHex(32);
}

/** Fresh 128-bit session nonce. */
export function randomNonce(): string {
  return randomFieldHex(16);
}

/* ------------------------------------------------------------------ */
/* Issuance                                                            */
/* ------------------------------------------------------------------ */

/** Turn an intake row into a committed credential with a fresh `r`. */
export function issueCredential(
  student: StudentRecord,
  leafIndex: number,
): IssuedCredential {
  const cgpaInt = cgpaToInt(student.cgpa);
  const r = randomBlindingFactor();
  const fields: CredentialFields = {
    name: student.name,
    rollNumber: student.rollNumber,
    identityCommitment: student.identityCommitment,
    cgpaInt,
    degreeCode: student.degreeCode,
    year: student.year,
    institutionId: INSTITUTION_ID,
  };

  return {
    ...student,
    cgpaInt,
    institutionId: INSTITUTION_ID,
    r,
    leaf: computeLeaf(fields, r),
    leafIndex,
  };
}

export function credentialFieldsOf(issued: IssuedCredential): CredentialFields {
  return {
    name: issued.name,
    rollNumber: issued.rollNumber,
    identityCommitment: issued.identityCommitment,
    cgpaInt: issued.cgpaInt,
    degreeCode: issued.degreeCode,
    year: issued.year,
    institutionId: issued.institutionId,
  };
}

export function buildBundle(params: {
  issued: IssuedCredential;
  semesterId: string;
  root: string;
  depth: number;
  leafCount: number;
  pathElements: string[];
  pathIndices: number[];
}): CredentialBundle {
  const {
    issued,
    semesterId,
    root,
    depth,
    leafCount,
    pathElements,
    pathIndices,
  } = params;

  return {
    version: "zk-credentials/bundle/1",
    issuer: { id: ISSUER_ID, name: ISSUER_NAME },
    semesterId,
    credential: credentialFieldsOf(issued),
    secrets: {
      r: issued.r,
      identitySecret: deriveDemoIdentitySecret(issued.rollNumber),
    },
    merkle: {
      leaf: issued.leaf,
      leafIndex: issued.leafIndex,
      pathElements,
      pathIndices,
      root,
      depth,
      leafCount,
    },
  };
}

/* ------------------------------------------------------------------ */
/* CSV intake                                                          */
/* ------------------------------------------------------------------ */

const REQUIRED_COLUMNS = [
  "name",
  "rollNumber",
  "identityCommitment",
  "cgpa",
  "degreeCode",
  "year",
] as const;

/**
 * Parse the intake CSV. Rows whose `identityCommitment` is blank or `auto` get
 * a commitment derived from the roll number, so a hand-written CSV still works
 * in the demo.
 */
export function parseStudentsCsv(text: string): StudentRecord[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (lines.length < 2) {
    throw new Error("CSV must contain a header row and at least one student");
  }

  const header = lines[0].split(",").map((cell) => cell.trim());
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) {
      throw new Error(
        'CSV is missing the "' +
          column +
          '" column (expected: ' +
          REQUIRED_COLUMNS.join(", ") +
          ")",
      );
    }
  }

  const indexOf = (column: string) => header.indexOf(column);

  return lines.slice(1).map((line, rowIndex) => {
    const cells = line.split(",").map((cell) => cell.trim());
    const rowNumber = rowIndex + 2;
    const read = (column: string) => cells[indexOf(column)] ?? "";
    const fail = (message: string) => {
      throw new Error("Row " + rowNumber + ": " + message);
    };

    const name = read("name");
    const rollNumber = read("rollNumber");
    if (!name || !rollNumber) fail("name and rollNumber are required");

    const cgpa = Number(read("cgpa"));
    if (!Number.isFinite(cgpa) || cgpa < 0 || cgpa > 10) {
      fail('CGPA "' + read("cgpa") + '" must be a number between 0 and 10');
    }

    const degreeCode = Number(read("degreeCode"));
    if (!Number.isInteger(degreeCode)) {
      fail('degreeCode "' + read("degreeCode") + '" must be an integer');
    }

    const year = Number(read("year"));
    if (!Number.isInteger(year) || year < 1900 || year > 2999) {
      fail('year "' + read("year") + '" must be a four-digit year');
    }

    const rawCommitment = read("identityCommitment");
    const identityCommitment =
      !rawCommitment || rawCommitment.toLowerCase() === "auto"
        ? computeIdentityCommitment(deriveDemoIdentitySecret(rollNumber))
        : toHex(rawCommitment);

    return { name, rollNumber, identityCommitment, cgpa, degreeCode, year };
  });
}

/* ------------------------------------------------------------------ */
/* Parsing / validation                                                */
/* ------------------------------------------------------------------ */

/** Structural check for an imported bundle, before any crypto runs. */
export function parseBundle(raw: unknown): CredentialBundle {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Bundle must be a JSON object");
  }
  const bundle = raw as Partial<CredentialBundle>;

  if (!bundle.credential || !bundle.secrets || !bundle.merkle) {
    throw new Error(
      "Bundle is missing one of: credential, secrets, merkle. Is this a credential file?",
    );
  }
  if (
    typeof bundle.secrets.r !== "string" ||
    typeof bundle.secrets.identitySecret !== "string"
  ) {
    throw new Error("Bundle secrets must contain r and identitySecret");
  }
  if (
    !Array.isArray(bundle.merkle.pathElements) ||
    !Array.isArray(bundle.merkle.pathIndices)
  ) {
    throw new Error("Bundle Merkle path is malformed");
  }
  if (typeof bundle.credential.cgpaInt !== "number") {
    throw new Error("Bundle credential is missing cgpaInt");
  }

  // Normalise every field element so downstream comparisons are exact.
  const credential = bundle.credential as CredentialFields;
  return {
    version: bundle.version ?? "zk-credentials/bundle/1",
    issuer: bundle.issuer ?? { id: ISSUER_ID, name: ISSUER_NAME },
    semesterId: bundle.semesterId ?? "unknown",
    credential: {
      ...credential,
      identityCommitment: toHex(credential.identityCommitment),
      institutionId: toHex(credential.institutionId),
    },
    secrets: {
      r: toHex(bundle.secrets.r),
      identitySecret: toHex(bundle.secrets.identitySecret),
    },
    merkle: {
      leaf: toHex(bundle.merkle.leaf),
      leafIndex: Number(bundle.merkle.leafIndex),
      pathElements: bundle.merkle.pathElements.map((element) => toHex(element)),
      pathIndices: bundle.merkle.pathIndices.map((index) => Number(index)),
      root: toHex(bundle.merkle.root),
      depth: Number(bundle.merkle.depth),
      leafCount: Number(bundle.merkle.leafCount),
    },
  };
}

/** Structural check for a pasted verification request. */
export function parseVerificationRequest(raw: unknown): VerificationRequest {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Request must be a JSON object");
  }
  const request = raw as Partial<VerificationRequest>;

  const numericFields: Array<keyof VerificationRequest> = [
    "threshold",
    "requiredDegreeCode",
    "minYear",
    "maxYear",
  ];
  for (const field of numericFields) {
    if (typeof request[field] !== "number") {
      throw new Error('Request field "' + field + '" must be a number');
    }
  }
  if (typeof request.nonce !== "string") {
    throw new Error("Request is missing a nonce");
  }

  return {
    requestId: request.requestId ?? "unknown",
    verifierName: request.verifierName ?? "Unnamed verifier",
    threshold: request.threshold as number,
    requiredDegreeCode: request.requiredDegreeCode as number,
    minYear: request.minYear as number,
    maxYear: request.maxYear as number,
    nonce: toHex(request.nonce),
    issuedAt: request.issuedAt ?? new Date().toISOString(),
  };
}

/** Plain-English rendering of a verification request. */
export function describeRequest(request: VerificationRequest): string {
  const cgpa = intToCgpa(request.threshold).toFixed(1);
  const years =
    request.minYear === request.maxYear
      ? "issued in " + request.minYear
      : "issued between " + request.minYear + " and " + request.maxYear;
  return (
    "Prove: CGPA is at least " +
    cgpa +
    ", degree is " +
    degreeName(request.requiredDegreeCode) +
    ", " +
    years
  );
}

export { toField };
