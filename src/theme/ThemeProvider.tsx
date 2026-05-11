import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

/** 用户可选择的外观模式。 */
export type ThemeMode = "light" | "dark" | "system";

type ThemeContextValue = {
  /** 当前保存的外观偏好。 */
  themeMode: ThemeMode;
  /** 设置外观偏好，并写入本地记忆。 */
  setThemeMode: (mode: ThemeMode) => void;
};

const STORAGE_KEY = "encode-lab-theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * 读取初始外观偏好。
 * @returns 本地保存的外观偏好；缺省时跟随系统
 */
function resolveInitialTheme(): ThemeMode {
  const savedTheme = window.localStorage.getItem(STORAGE_KEY);
  if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "system") {
    return savedTheme;
  }

  return "system";
}

/**
 * 判断当前系统是否偏好深色模式。
 * @returns 系统深色偏好
 */
function prefersDarkMode() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * 将外观偏好同步到根节点 class。
 * @param mode 用户外观偏好
 */
function applyThemeMode(mode: ThemeMode) {
  const shouldUseDark = mode === "dark" || (mode === "system" && prefersDarkMode());
  document.documentElement.classList.toggle("dark", shouldUseDark);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => resolveInitialTheme());

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    window.localStorage.setItem(STORAGE_KEY, mode);
  };

  useEffect(() => {
    applyThemeMode(themeMode);

    if (themeMode !== "system") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => applyThemeMode("system");

    mediaQuery.addEventListener("change", syncSystemTheme);
    return () => mediaQuery.removeEventListener("change", syncSystemTheme);
  }, [themeMode]);

  const value = useMemo(
    () => ({
      themeMode,
      setThemeMode,
    }),
    [themeMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return context;
}

