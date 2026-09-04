// Public Contracts Scotland (PCS) notice search proxy.
//
// Ported from supabase/functions/contracts-scotland (Deno). Query building,
// keyword filtering, status mapping and release mapping are unchanged.
//
// TLS note: the Deno original embedded the Sectigo intermediate CA because the
// Supabase Edge Runtime's trust store did not include it, and injected it via
// Deno.createHttpClient({ caCerts }). Node has no such API, so the equivalent
// here is an undici Agent used as the fetch dispatcher, whose CA list is the
// certificate APPENDED to Node's built-in roots (tls.rootCertificates) - the
// append matters: passing the intermediate alone would replace the default
// store and break verification of the rest of the chain.
//
// Node's own trust store may well already verify PCS without this. The cert is
// kept so the port is faithful and so the function cannot regress if the chain
// changes; getDispatcher() degrades to plain fetch if the Agent cannot be built.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { Agent } from "undici";
import { rootCertificates } from "node:tls";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const PCS_BASE = "https://api.publiccontractsscotland.gov.uk/v1/Notices";

// Sectigo Public Server Authentication CA DV R36 - intermediate used by api.publiccontractsscotland.gov.uk
const SECTIGO_CA = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQOXpmzCdWNi4NqofKbqvjsTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgRFYgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEAljZf2HIz7+SPUPQCQObZYcrxLTHYdf1ZtMRe7Yeq
RPSwygz16qJ9cAWtWNTcuICc++p8Dct7zNGxCpqmEtqifO7NvuB5dEVexXn9RFFH
12Hm+NtPRQgXIFjx6MSJcNWuVO3XGE57L1mHlcQYj+g4hny90aFh2SCZCDEVkAja
EMMfYPKuCjHuuF+bzHFb/9gV8P9+ekcHENF2nR1efGWSKwnfG5RawlkaQDpRtZTm
M64TIsv/r7cyFO4nSjs1jLdXYdz5q3a4L0NoabZfbdxVb+CUEHfB0bpulZQtH1Rv
38e/lIdP7OTTIlZh6OYL6NhxP8So0/sht/4J9mqIGxRFc0/pC8suja+wcIUna0HB
pXKfXTKpzgis+zmXDL06ASJf5E4A2/m+Hp6b84sfPAwQ766rI65mh50S0Di9E3Pn
2WcaJc+PILsBmYpgtmgWTR9eV9otfKRUBfzHUHcVgarub/XluEpRlTtZudU5xbFN
xx/DgMrXLUAPaI60fZ6wA+PTAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQUaMASFhgOr872h6YyV6NGUV3LBycw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgEw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
YtOC9Fy+TqECFw40IospI92kLGgoSZGPOSQXMBqmsGWZUQ7rux7cj1du6d9rD6C8
ze1B2eQjkrGkIL/OF1s7vSmgYVafsRoZd/IHUrkoQvX8FZwUsmPu7amgBfaY3g+d
q1x0jNGKb6I6Bzdl6LgMD9qxp+3i7GQOnd9J8LFSietY6Z4jUBzVoOoz8iAU84OF
h2HhAuiPw1ai0VnY38RTI+8kepGWVfGxfBWzwH9uIjeooIeaosVFvE8cmYUB4TSH
5dUyD0jHct2+8ceKEtIoFU/FfHq/mDaVnvcDCZXtIgitdMFQdMZaVehmObyhRdDD
4NQCs0gaI9AAgFj4L9QtkARzhQLNyRf87Kln+YU0lgCGr9HLg3rGO8q+Y4ppLsOd
unQZ6ZxPNGIfOApbPVf5hCe58EZwiWdHIMn9lPP6+F404y8NNugbQixBber+x536
WrZhFZLjEkhp7fFXf9r32rNPfb74X/U90Bdy4lzp3+X1ukh1BuMxA/EEhDoTOS3l
7ABvc7BYSQubQ2490OcdkIzUh3ZwDrakMVrbaTxUM2p24N6dB+ns2zptWCva6jzW
r8IWKIMxzxLPv5Kt3ePKcUdvkBU/smqujSczTzzSjIoR5QqQA6lN1ZRSnuHIWCvh
JEltkYnTAH41QJ6SAWO66GrrUESwN/cgZzL4JLEqz1Y=
-----END CERTIFICATE-----
`;

let dispatcher: Agent | null | undefined;
function getDispatcher(): Agent | undefined {
  if (dispatcher !== undefined) return dispatcher ?? undefined;
  try {
    dispatcher = new Agent({
      connect: { ca: [...rootCertificates, SECTIGO_CA] },
    });
  } catch (e) {
    console.warn("undici Agent creation failed:", e);
    dispatcher = null;
  }
  return dispatcher ?? undefined;
}

// Mirrors Deno's `await req.json()`: an absent or malformed body throws.
function readJsonBody(event: APIGatewayProxyEventV2): any {
  const raw = event.isBase64Encoded && event.body
    ? Buffer.from(event.body, "base64").toString("utf-8")
    : event.body ?? "";
  return JSON.parse(raw);
}

// noticeType: 1=Prior Info, 2=Contract Notice (Open), 3=Award, etc.
function mapNoticeTypeToStatus(nt: number, tag: string): string {
  if (tag === "award" || nt === 3) return "Awarded";
  if (tag === "tender" || nt === 2) return "Open";
  if (tag === "planning" || nt === 1) return "Pipeline";
  return "Unknown";
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "ok" };
  }

  try {
    const { keyword, dateFrom, noticeType, limit } = readJsonBody(event);

    const params = new URLSearchParams();
    if (dateFrom) {
      params.set("dateFrom", dateFrom);
    } else {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      params.set("dateFrom", `${mm}-${d.getFullYear()}`);
    }
    params.set("noticeType", String(noticeType ?? 2));
    params.set("outputType", "0");

    const url = `${PCS_BASE}?${params.toString()}`;
    console.log("PCS URL:", url);

    const fetchOpts: any = {
      method: "GET",
      headers: { "Accept": "application/json" },
    };
    const agent = getDispatcher();
    if (agent) fetchOpts.dispatcher = agent;

    const response = await fetch(url, fetchOpts);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("PCS API error:", response.status, errorText);
      return {
        statusCode: response.status,
        headers: jsonHeaders,
        body: JSON.stringify({ error: `API returned ${response.status}`, details: errorText }),
      };
    }

    const data: any = await response.json();
    const releases = data.releases || [];

    const keywordLower = keyword?.toLowerCase() || "";
    const filtered = keywordLower
      ? releases.filter((r: any) => {
          const title = (r.tender?.title || "").toLowerCase();
          const desc = (r.tender?.description || "").toLowerCase();
          const buyer = (r.buyer?.name || "").toLowerCase();
          return title.includes(keywordLower) || desc.includes(keywordLower) || buyer.includes(keywordLower);
        })
      : releases;

    const max = limit || 100;
    const sliced = filtered.slice(0, max);

    const notices = sliced.map((release: any) => {
      const tender = release.tender || {};
      const awards = release.awards || [];
      const buyer = release.buyer || {};
      const value = tender.value || awards[0]?.value || {};
      const tag = release.tag?.[0] || "";
      const noticeDoc = (tender.documents || []).find((d: any) => d.documentType === "contractNotice") || tender.documents?.[0];

      return {
        id: release.ocid || release.id || "",
        title: tender.title || "Untitled",
        buyer: buyer.name || "Unknown",
        description: tender.description || "",
        value: value.amount || 0,
        valueHigh: value.amount || 0,
        currency: value.currency || "GBP",
        status: mapNoticeTypeToStatus(Number(noticeType ?? 2), tag),
        publishedDate: release.date || "",
        deadlineDate: tender.tenderPeriod?.endDate || "",
        region: tender.items?.[0]?.deliveryAddresses?.[0]?.region || "Scotland",
        sector: tender.mainProcurementCategory || "",
        cpvCode: tender.items?.[0]?.classification?.id || "",
        source: "Public Contracts Scotland",
        noticeType: tag || "tender",
        link: noticeDoc?.url || "https://www.publiccontractsscotland.gov.uk/",
      };
    });

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        notices,
        total: filtered.length,
        cursor: null,
        uri: data.uri || url,
      }),
    };
  } catch (error) {
    console.error("Error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: msg }),
    };
  }
};
