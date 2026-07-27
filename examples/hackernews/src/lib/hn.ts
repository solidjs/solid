"use server";
// The HN data source, server-only. Module-level directive: the client build
// replaces this whole module with reference proxies, so the cached thread
// below never reaches the browser — important, because it is 600KB.
import type { StoryDefinition, StoryTypes, UserDefinition } from "~/types";
import cachedStory from "./story-30186326.json";

const story = (path: string) => `https://node-hnapi.herokuapp.com/${path}`;
const user = (path: string) => `https://hacker-news.firebaseio.com/v0/${path}.json`;

/**
 * One thread is served from a capture instead of the network: 30186326
 * ("Facebook loses users for the first time", 1,406 comments, 14 levels
 * deep). It is the scale case both this app and the server-components twin
 * are measured on, and a live fetch of it costs 0.7–9s depending on how warm
 * the upstream is — variance that would swamp anything we're trying to
 * measure. Every other story goes to the network.
 */
const CACHED_STORY_ID = String(cachedStory.id);

const mapStories = {
  top: "news",
  new: "newest",
  show: "show",
  ask: "ask",
  job: "jobs"
} as const;

async function fetchAPI(path: string) {
  const url = path.startsWith("user") ? user(path) : story(path);
  const response = await fetch(url, { headers: { "User-Agent": "chrome" } });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`Received from API: ${text}`);
    return { error: e };
  }
}

export async function getStories(type: StoryTypes, page: number): Promise<StoryDefinition[]> {
  const storyType = mapStories[type];
  if (!storyType) return [];
  return fetchAPI(`${storyType}?page=${page}`);
}

export async function getStory(id: string): Promise<StoryDefinition> {
  if (id === CACHED_STORY_ID) return cachedStory as unknown as StoryDefinition;
  return fetchAPI(`item/${id}`);
}

export async function getUser(id: string): Promise<UserDefinition> {
  return fetchAPI(`user/${id}`);
}
