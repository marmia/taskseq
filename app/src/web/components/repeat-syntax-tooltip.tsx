import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";

const repeatSyntaxExamples = [
  ["day", "taskAuthoring.repeat.examples.day"],
  ["mon, wed", "taskAuthoring.repeat.examples.weekdays"],
  ["5, 10", "taskAuthoring.repeat.examples.monthDates"],
  ["2nd tue", "taskAuthoring.repeat.examples.monthWeekday"],
  ["2nd tue -1", "taskAuthoring.repeat.examples.offset"],
] as const;

export function RepeatSyntaxTooltip() {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      aria-label={t("taskAuthoring.repeat.ariaLabel")}
      className="group relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
    >
      <CircleHelp size={14} aria-hidden="true" />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 z-10 mb-2 hidden w-80 rounded-lg bg-slate-900 p-3 text-left text-[11px] font-normal leading-5 text-white shadow-lg group-hover:block group-focus-within:block"
      >
        <p>{t("taskAuthoring.repeat.heading")}</p>
        <ul className="list-disc pl-4">
          {repeatSyntaxExamples.map(([syntax, descriptionKey]) => (
            <li key={syntax}>
              <code>{syntax}</code>{" "}
              <span className="text-slate-400">({t(descriptionKey)})</span>
            </li>
          ))}
        </ul>
      </span>
    </button>
  );
}
