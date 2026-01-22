import { env } from "./env";

const HUBSPOT_BASE_URL = "https://api.hubapi.com";

type HubSpotContact = {
  id: string;
  properties?: Record<string, string>;
};

async function hubspotFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${HUBSPOT_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HubSpot error ${response.status}: ${body}`);
  }

  return (await response.json()) as T;
}

export async function searchContactByEmail(
  email: string
): Promise<HubSpotContact | null> {
  const payload = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: "email",
            operator: "EQ",
            value: email,
          },
        ],
      },
    ],
    properties: ["email"],
    limit: 1,
  };

  const result = await hubspotFetch<{
    results: HubSpotContact[];
  }>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return result.results[0] ?? null;
}

export async function createContact(properties: Record<string, string | null>) {
  return hubspotFetch<HubSpotContact>("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
}

export async function updateContact(
  contactId: string,
  properties: Record<string, string | null>
) {
  return hubspotFetch<HubSpotContact>(`/crm/v3/objects/contacts/${contactId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
}
