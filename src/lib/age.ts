export type AgeBand =
  | "50 - 54"
  | "55 - 59"
  | "60 - 64"
  | "65 - 69"
  | "70 - 74"
  | "75 - 79"
  | "80 - 84"
  | "out_of_range";

const DAYS_IN_YEAR = 365.25;

export function calculateAge(dob: Date, today: Date = new Date()): number {
  const birthYear = dob.getUTCFullYear();
  const birthMonth = dob.getUTCMonth();
  const birthDate = dob.getUTCDate();

  let age = today.getUTCFullYear() - birthYear;
  const monthDiff = today.getUTCMonth() - birthMonth;
  const dayDiff = today.getUTCDate() - birthDate;

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  return age;
}

export function daysToBirthday(dob: Date, today: Date = new Date()): number {
  const year = today.getUTCFullYear();
  const nextBirthday = new Date(
    Date.UTC(year, dob.getUTCMonth(), dob.getUTCDate())
  );

  if (nextBirthday < today) {
    nextBirthday.setUTCFullYear(year + 1);
  }

  const diffMs = nextBirthday.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function effectiveAge(dob: Date, today: Date = new Date()): number {
  const baseAge = calculateAge(dob, today);
  const days = daysToBirthday(dob, today);
  return days <= 30 ? baseAge + 1 : baseAge;
}

export function ageBand(age: number): AgeBand {
  if (age >= 50 && age <= 54) return "50 - 54";
  if (age >= 55 && age <= 59) return "55 - 59";
  if (age >= 60 && age <= 64) return "60 - 64";
  if (age >= 65 && age <= 69) return "65 - 69";
  if (age >= 70 && age <= 74) return "70 - 74";
  if (age >= 75 && age <= 79) return "75 - 79";
  if (age >= 80 && age <= 84) return "80 - 84";
  return "out_of_range";
}

export function effectiveAgeBand(dob: Date, today: Date = new Date()): {
  effectiveAge: number;
  band: AgeBand;
} {
  const effAge = effectiveAge(dob, today);
  return { effectiveAge: effAge, band: ageBand(effAge) };
}
