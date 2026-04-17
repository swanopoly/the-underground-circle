import AsyncStorage from '@react-native-async-storage/async-storage';

const WIKI_PROGRESS_KEY = '@wiki_progress';

export interface WikiProgress {
  readArticleIds: string[];
  lastReadArticleId?: string;
}

const DEFAULT_WIKI_PROGRESS: WikiProgress = {
  readArticleIds: [],
};

export async function getWikiProgress(): Promise<WikiProgress> {
  try {
    const raw = await AsyncStorage.getItem(WIKI_PROGRESS_KEY);
    return raw ? JSON.parse(raw) : { ...DEFAULT_WIKI_PROGRESS };
  } catch {
    return { ...DEFAULT_WIKI_PROGRESS };
  }
}

export async function markWikiArticleRead(articleId: string): Promise<WikiProgress> {
  const progress = await getWikiProgress();
  const readArticleIds = progress.readArticleIds.includes(articleId)
    ? progress.readArticleIds
    : [...progress.readArticleIds, articleId];

  const nextProgress: WikiProgress = {
    readArticleIds,
    lastReadArticleId: articleId,
  };

  await AsyncStorage.setItem(WIKI_PROGRESS_KEY, JSON.stringify(nextProgress));
  return nextProgress;
}
