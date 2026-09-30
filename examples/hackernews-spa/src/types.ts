export interface CommentDefinition {
  id: number;
  user: string;
  time_ago: string;
  content: string;
  comments: CommentDefinition[];
}

export interface StoryDefinition {
  id: number;
  points: string;
  url: string;
  title: string;
  domain: string;
  type: string;
  time_ago: string;
  user: string;
  comments_count: number;
  comments: CommentDefinition[];
}

export interface UserDefinition {
  error: string;
  id: string;
  created: string;
  karma: number;
  about: string;
}

export type StoryTypes = "top" | "new" | "show" | "ask" | "job";
