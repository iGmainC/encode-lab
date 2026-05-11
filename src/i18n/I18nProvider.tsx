import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { translations, type TranslationKey } from "./translations";

/** 当前支持的界面语言。 */
export type AppLanguage = "zh-CN" | "en-US";

type TranslateParams = Record<string, string | number>;

type I18nContextValue = {
  /** 当前界面语言。 */
  language: AppLanguage;
  /** 切换界面语言，并写入本地记忆。 */
  setLanguage: (language: AppLanguage) => void;
  /** 按 key 获取当前语言文案。 */
  t: (key: TranslationKey, params?: TranslateParams) => string;
};

const STORAGE_KEY = "encode-lab-language";

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * 解析应用初始语言。
 * @returns 本地记忆、浏览器语言或默认中文
 */
function resolveInitialLanguage(): AppLanguage {
  const savedLanguage = window.localStorage.getItem(STORAGE_KEY);
  if (savedLanguage === "zh-CN" || savedLanguage === "en-US") {
    return savedLanguage;
  }

  // 中文用户默认进入中文，其余语言默认英文，方便后续拓展更多 locale。
  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

/**
 * 用参数替换文案中的占位符。
 * @param value 原始文案
 * @param params 替换参数
 * @returns 替换后的文案
 */
function interpolate(value: string, params?: TranslateParams) {
  if (!params) {
    return value;
  }

  return value.replace(/\{\{(\w+)}}/g, (_, key: string) => String(params[key] ?? ""));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() => resolveInitialLanguage());

  const setLanguage = (nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage);
    window.localStorage.setItem(STORAGE_KEY, nextLanguage);
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, params) => interpolate(translations[language][key] ?? key, params),
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}

