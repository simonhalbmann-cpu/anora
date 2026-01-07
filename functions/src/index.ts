// functions/src/index.ts

import dotenvx from "dotenv";
import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";

import { httpHandler } from "./entry/httpHandler";

// .env laden (aus functions/)
dotenvx.config();

// Firebase Admin init
if (!admin.apps.length) {
  admin.initializeApp();
}

// Ein einziger HTTPS Entry (wir hängen später weitere Exports wieder sauber dran)
export const api = onRequest((req, res) => httpHandler(req as any, res as any));