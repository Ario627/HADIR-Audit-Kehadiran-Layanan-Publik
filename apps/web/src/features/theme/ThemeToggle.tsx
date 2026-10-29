import { THEMES, THEME_HINTS, THEME_LABELS } from '../../lib/theme';
import { useTheme } from '../../lib/use-theme';

const GROUP_NAME = 'tema';

export function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  return (
    <fieldset className="themepick">
      <legend className="visually-hidden">Tema tampilan</legend>
      {THEMES.map((option) => (
        <label key={option} className="themepick-opt" title={THEME_HINTS[option]}>
          <input
            type="radio"
            name={GROUP_NAME}
            value={option}
            checked={choice === option}
            onChange={() => {
              setChoice(option);
            }}
          />
          <span>{THEME_LABELS[option]}</span>
        </label>
      ))}
    </fieldset>
  );
}