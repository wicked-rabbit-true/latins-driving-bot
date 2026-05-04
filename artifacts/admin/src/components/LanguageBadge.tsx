export const LANG_BADGE_COLORS: Record<string, string> = {
  en: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  es: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  ja: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  pt: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  fr: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  de: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  it: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  ko: "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300",
  zh: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  ru: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  ar: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  hi: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  pl: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  tr: "bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300",
  ur: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
};

export function LanguageBadge({ language }: { language: string | null | undefined }) {
  if (!language) return null;
  const key = language.toLowerCase();
  const style = LANG_BADGE_COLORS[key] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${style}`}>
      {language.toUpperCase()}
    </span>
  );
}
