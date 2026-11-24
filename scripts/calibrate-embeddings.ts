import {
  EMBEDDING_CALIBRATION_FIXTURE,
  evaluateCalibration,
  scoreCalibrationFixture,
  suggestThresholds,
} from "../src/server/catalog/embedding-calibration.ts";
import { createOnnxEmbedder } from "../src/server/catalog/embedder.ts";
import { DEFAULT_EMBEDDING_THRESHOLDS } from "../src/server/catalog/classifier.ts";

const embedder = createOnnxEmbedder();

const scored = await scoreCalibrationFixture(embedder, EMBEDDING_CALIBRATION_FIXTURE);

const atDefault = evaluateCalibration(
  scored,
  DEFAULT_EMBEDDING_THRESHOLDS.acceptTop1,
  DEFAULT_EMBEDDING_THRESHOLDS.acceptMargin,
);

const suggested = suggestThresholds(scored);

process.stdout.write(`${JSON.stringify({ atDefault, scored, suggested }, null, 2)}\n`);
