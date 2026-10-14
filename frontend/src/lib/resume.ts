export type ResumeEntry = {
  company?: string;
  title?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  current?: boolean;
  description?: string;
};

export type ResumeData = {
  personalInfo: {
    fullName: string;
    email: string;
    phone: string;
    location: string;
    linkedin: string;
    github: string;
    website: string;
  };
  summary: string;
  experience: ResumeEntry[];
  education: Array<{
    institution: string;
    degree: string;
    field: string;
    startDate: string;
    endDate: string;
    grade: string;
    description: string;
  }>;
  skills: Array<{ category: string; items: string[] }>;
  projects: Array<{ name: string; url: string; technologies: string[]; description: string }>;
  certifications: Array<{ name: string; issuer: string; date: string; url: string }>;
  achievements: string[];
};

export type Resume = {
  _id: string;
  id?: string;
  title: string;
  templateId: string;
  version: number;
  data: ResumeData;
  updatedAt?: string;
};

export function emptyResumeData(): ResumeData {
  return {
    personalInfo: { fullName: "", email: "", phone: "", location: "", linkedin: "", github: "", website: "" },
    summary: "",
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
    achievements: [],
  };
}

export function normalizeResumeData(data?: Partial<ResumeData>): ResumeData {
  const empty = emptyResumeData();
  return {
    ...empty,
    ...data,
    personalInfo: { ...empty.personalInfo, ...data?.personalInfo },
    experience: data?.experience ?? [],
    education: data?.education ?? [],
    skills: data?.skills ?? [],
    projects: data?.projects ?? [],
    certifications: data?.certifications ?? [],
    achievements: data?.achievements ?? [],
  };
}
