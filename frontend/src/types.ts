export type JobType = 'Full-time' | 'Part-time' | 'Contract' | 'Internship' | 'Unknown';
export type WorkMode = 'Remote' | 'Hybrid' | 'On-site' | 'Unknown';

export type Job = {
  id: string;
  title: string;
  companyName: string;
  location: string;
  description: string;
  jobType: JobType;
  workMode: WorkMode;
  postedAt: string;
  applyUrl: string;
  source: 'adzuna' | 'mock';
  match?: {
    score: number;
    explanation: string;
    matchingSkills: string[];
    missingSkills: string[];
  };
};

export type ApplicationStatus = 'Applied' | 'Interview' | 'Offer' | 'Rejected';

export type ApplicationTimelineEvent = {
  at: string;
  type: 'StatusChange' | 'Note' | 'Created';
  message: string;
};

export type Application = {
  id: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  applyUrl: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
  timeline: ApplicationTimelineEvent[];
};
