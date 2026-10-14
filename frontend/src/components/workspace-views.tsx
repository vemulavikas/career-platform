"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, apiRequest, errorMessage, type ApiUser } from "@/lib/api";
import { emptyResumeData, normalizeResumeData, type Resume, type ResumeData } from "@/lib/resume";
import { useAuth } from "@/contexts/auth-context";
import { RichEditor } from "@/components/rich-editor";

type DashboardSummary = {
  totalResumes: number;
  totalChats: number;
  upcomingConsultations: number;
  completedConsultations: number;
};

type ChatSession = { _id: string; title: string; updatedAt?: string; messageCount?: number };
type ChatMessage = { _id: string; role: "user" | "assistant"; content: string };
type Booking = {
  id: string;
  consultantName: string;
  startAt: string;
  endAt: string;
  state: string;
  checkoutUrl?: string;
  meetingUrl?: string;
};
type Consultant = { id: string; name: string; timeZone: string };
type Slot = { startAt: string; endAt: string; available: boolean };

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action}</div>;
}

function LoadingCard({ label = "Loading..." }: { label?: string }) {
  return <div className="state-card" role="status"><span className="spinner" />{label}</div>;
}

function ErrorCard({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div className="state-card state-error" role="alert"><span>{errorMessage(error)}</span>{retry && <button className="button button-outline button-small" onClick={retry}>Try again</button>}</div>;
}

export function DashboardView() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { setData(await apiRequest<DashboardSummary>("/api/dashboard")); setError(null); }
    catch (reason) { setError(reason); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);
  const stats = [
    { label: "Resume drafts", value: data?.totalResumes },
    { label: "Career chats", value: data?.totalChats },
    { label: "Upcoming sessions", value: data?.upcomingConsultations },
    { label: "Completed sessions", value: data?.completedConsultations },
  ];

  return <>
    <PageHeading eyebrow="YOUR CAREER WORKSPACE" title={`Good to see you, ${user?.name?.split(" ")[0] ?? "there"}.`} description="Your next step is yours to choose." />
    <div className="welcome-banner">
      <div><span className="banner-kicker">A moment to focus</span><h2>Small, thoughtful progress adds up.</h2><p>Use your workspace to get ideas down, make your experience clear, and plan a conversation when you re ready.</p></div>
      <div className="banner-orbit" aria-hidden="true"><span> </span></div>
    </div>
    {error ? <ErrorCard error={error} retry={() => void load()} /> : loading ? <LoadingCard label="Getting your workspace ready " /> : <div className="stat-grid">{stats.map((stat) => <div className="stat-card" key={stat.label}><span>{stat.label}</span><strong>{stat.value ?? 0}</strong></div>)}</div>}
    <div className="section-title-row"><div><p className="eyebrow">PICK UP MOMENTUM</p><h2>What would help today?</h2></div></div>
    <div className="action-grid">
      <Link className="action-card" href="/chat"><span className="action-icon">&#10022;</span><h3>Think it through</h3><p>Start a career conversation and get unstuck on your next decision.</p><span className="action-link">Open career chat &rarr;</span></Link>
      <Link className="action-card" href="/resumes/create"><span className="action-icon">&#9635;</span><h3>Shape your story</h3><p>Build and refine a structured resume you can preview and print.</p><span className="action-link">Create a resume &rarr;</span></Link>
      <Link className="action-card" href="/consultations/book"><span className="action-icon">&#9719;</span><h3>Talk it over</h3><p>Browse available consultants and see whether a time works for you.</p><span className="action-link">Explore consultations &rarr;</span></Link>
      <Link className="action-card" href="/profile"><span className="action-icon">&#9678;</span><h3>Keep your details current</h3><p>Update the name, contact information, and career profile attached to your account.</p><span className="action-link">Edit your profile &rarr;</span></Link>
    </div>
    <p className="provider-note">AI replies and paid bookings depend on configuration by the platform operator. Your account credentials remain with the API; only session tokens are stored in this browser.</p>
  </>;
}

export function ChatListView() {
  const router = useRouter();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => {
    try { const result = await apiRequest<{ items: ChatSession[] }>("/api/chat/sessions?limit=50"); setSessions(result.items); setError(null); }
    catch (reason) { setError(reason); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);
  async function createChat() {
    setCreating(true);
    setError(null);
    try {
      const result = await apiRequest<{ session: ChatSession }>("/api/chat/sessions", { method: "POST", body: JSON.stringify({}) });
      router.push(`/chat/${result.session._id}`);
    } catch (reason) { setError(reason); setCreating(false); }
  }
  async function deleteChat(id: string) {
    if (!window.confirm("Delete this conversation and its messages?")) return;
    try { await apiRequest(`/api/chat/sessions/${id}`, { method: "DELETE" }); setSessions((current) => current.filter((session) => session._id !== id)); }
    catch (reason) { setError(reason); }
  }
  return <>
    <PageHeading eyebrow="CAREER CHAT" title="A space to think out loud." description="Talk through a decision, practice explaining your experience, or get a fresh perspective." action={<button className="button button-primary" onClick={() => void createChat()} disabled={creating}>{creating ? "Starting " : "+ New conversation"}</button>} />
    {error && <ErrorCard error={error} retry={() => void load()} />}
    {loading ? <LoadingCard label="Loading conversations " /> : sessions.length ? <div className="list-card">{sessions.map((session) => <div className="list-row" key={session._id}>
      <Link href={`/chat/${session._id}`} className="list-main"><span className="list-icon">&#10022;</span><span><strong>{session.title || "New conversation"}</strong><small>{session.messageCount ? `${session.messageCount} messages` : "No messages yet"}{session.updatedAt ? `  Updated ${new Date(session.updatedAt).toLocaleDateString()}` : ""}</small></span></Link>
      <button className="icon-button danger-text" aria-label={`Delete ${session.title}`} onClick={() => void deleteChat(session._id)}>Delete</button>
    </div>)}</div> : <div className="empty-state"><span className="empty-illustration">&#10022;</span><h2>No conversations yet</h2><p>Start a private workspace chat when you are ready to explore your next move.</p><button className="button button-primary" onClick={() => void createChat()} disabled={creating}>Start a conversation</button></div>}
    <div className="notice notice-soft"><strong>AI availability</strong><span>Messages require an AI provider configured by the platform operator. No AI key is stored in this frontend.</span></div>
  </>;
}

export function ChatDetailView() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [title, setTitle] = useState("Conversation");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ session: ChatSession; messages: ChatMessage[] }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}?limit=100`);
      setTitle(result.session.title);
      setMessages(result.messages);
      setError(null);
    } catch (reason) { setError(reason); }
    finally { setLoading(false); }
  }, [sessionId]);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await apiRequest<{ userMessage: ChatMessage; assistantMessage: ChatMessage; session: ChatSession }>(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
        { method: "POST", body: JSON.stringify({ content }) },
      );
      setTitle(result.session.title);
      setMessages((current) => [...current, result.userMessage, result.assistantMessage]);
      setDraft("");
    } catch (reason) { setError(reason); }
    finally { setSending(false); }
  }
  return <>
    <div className="chat-heading"><Link className="text-link" href="/chat">&larr; All conversations</Link><h1>{title || "New conversation"}</h1><p>Career conversations for your own reflection and planning.</p></div>
    {loading ? <LoadingCard label="Opening conversation " /> : error && !messages.length ? <ErrorCard error={error} retry={() => void load()} /> : <>
      <section className="chat-thread" aria-label="Conversation messages">
        {messages.length === 0 && <div className="chat-empty"><span> </span><h2>What s on your mind?</h2><p>Share the decision, challenge, or career goal you d like to think through.</p></div>}
        {messages.map((message, index) => <article className={`chat-message ${message.role}`} key={message._id || `${message.role}-${index}`}><span className="message-author">{message.role === "user" ? "You" : "Career Assistant"}</span><p>{message.content}</p></article>)}
        {sending && <article className="chat-message assistant"><span className="message-author">Career Assistant</span><p className="typing-indicator">Preparing a response </p></article>}
      </section>
      {error && <div className="alert alert-error" role="alert">{errorMessage(error)}</div>}
      <form className="chat-compose" onSubmit={submit}><label className="sr-only" htmlFor="chat-message">Your message</label><textarea id="chat-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} rows={3} placeholder="Write your message..." required /><div className="compose-footer"><span>{draft.length}/4000</span><button className="button button-primary" disabled={sending || !draft.trim()}>{sending ? "Sending..." : "Send message"}</button></div></form>
    </>}
  </>;
}

export function ResumesView() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const load = useCallback(async (query = "") => {
    try {
      const result = await apiRequest<{ items: Resume[] }>(`/api/resumes?page=1&limit=50${query ? `&search=${encodeURIComponent(query)}` : ""}`);
      setResumes(result.items);
      setError(null);
    } catch (reason) { setError(reason); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);
  async function duplicate(id: string) {
    try {
      const result = await apiRequest<{ resume: Resume }>(`/api/resumes/${id}/duplicate`, { method: "POST", body: JSON.stringify({}) });
      setResumes((current) => [result.resume, ...current]);
    } catch (reason) { setError(reason); }
  }
  async function remove(id: string) {
    if (!window.confirm("Delete this resume and its saved versions?")) return;
    try { await apiRequest(`/api/resumes/${id}`, { method: "DELETE" }); setResumes((current) => current.filter((resume) => resume._id !== id)); }
    catch (reason) { setError(reason); }
  }
  function searchResumes(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void load(search.trim()); }
  return <>
    <PageHeading eyebrow="YOUR RESUME LIBRARY" title="Make your experience easy to see." description="Draft, refine, and preview a structured resume. Your changes are saved to your account." action={<Link className="button button-primary" href="/resumes/create">+ Create resume</Link>} />
    <form className="search-form" onSubmit={searchResumes}><label className="sr-only" htmlFor="resume-search">Search resumes</label><input id="resume-search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} placeholder="Search by resume name" /><button className="button button-outline button-small">Search</button></form>
    {error && <ErrorCard error={error} retry={() => void load(search)} />}
    {loading ? <LoadingCard label="Loading your resumes " /> : resumes.length ? <div className="resume-grid">{resumes.map((resume) => <article className="resume-card" key={resume._id}>
      <div className="resume-preview-mini"><span className="mini-line mini-name" /><span className="mini-line" /><span className="mini-line short" /><span className="mini-rule" /><span className="mini-line" /><span className="mini-line" /><span className="mini-line short" /><span className="mini-rule" /><span className="mini-line" /><span className="mini-line short" /></div>
      <div className="resume-card-body"><div className="resume-card-top"><span className="template-pill">{resume.templateId || "modern"} template</span><span className="version-label">v{resume.version ?? 1}</span></div><h2>{resume.title}</h2><p>{resume.data?.personalInfo?.fullName || "Add your name and contact details"}</p><small>Updated {resume.updatedAt ? new Date(resume.updatedAt).toLocaleDateString() : "recently"}</small>
        <div className="resume-actions"><Link href={`/resumes/${resume._id}/edit`}>Edit</Link><Link href={`/resumes/${resume._id}/preview`}>Preview</Link><button onClick={() => void duplicate(resume._id)}>Duplicate</button><button className="danger-text" onClick={() => void remove(resume._id)}>Delete</button></div>
      </div>
    </article>)}</div> : <div className="empty-state"><span className="empty-illustration">&#9635;</span><h2>{search ? "No matching resumes" : "Your first draft starts here"}</h2><p>{search ? "Try another search term, or clear the search to see every resume." : "Put your experience in one place. You can edit it any time and print the preview when it is ready."}</p>{search ? <button className="button button-outline" onClick={() => { setSearch(""); void load(); }}>Clear search</button> : <Link className="button button-primary" href="/resumes/create">Create a resume</Link>}</div>}
    <p className="provider-note">AI resume writing is only available when the operator has configured an AI provider. You can create and edit your resume without AI.</p>
  </>;
}

export function ResumeEditorView({ mode }: { mode: "create" | "edit" }) {
  const params = useParams<{ id?: string }>();
  const id = params.id;
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [templateId, setTemplateId] = useState("modern");
  const [data, setData] = useState<ResumeData>(emptyResumeData);
  const [version, setVersion] = useState<number | undefined>();
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [targetRole, setTargetRole] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    let active = true;
    apiRequest<{ resume: Resume }>(`/api/resumes/${encodeURIComponent(id)}`)
      .then(({ resume }) => {
        if (!active) return;
        setTitle(resume.title);
        setTemplateId(resume.templateId || "modern");
        setData(normalizeResumeData(resume.data));
        setVersion(resume.version);
      })
      .catch((reason) => { if (active) setError(reason); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, mode]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data.personalInfo.fullName.trim()) {
      setError(new ApiError("Add your full name before saving.", 400));
      return;
    }
    const resumeData = {
      ...data,
      skills: data.skills.map((group) => ({ ...group, items: group.items.map((item) => item.trim().slice(0, 60)).filter(Boolean) })).filter((group) => group.items.length),
      projects: data.projects.map((project) => ({ ...project, technologies: project.technologies.map((item) => item.slice(0, 60)) })),
      achievements: data.achievements.map((item) => item.trim()).filter(Boolean),
    };
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      if (mode === "create") {
        const result = await apiRequest<{ resume: Resume }>("/api/resumes", {
          method: "POST",
          body: JSON.stringify({ title: title.trim() || `${data.personalInfo.fullName}'s resume`, templateId, data: resumeData }),
        });
        router.replace(`/resumes/${result.resume._id}/edit`);
        setSaved(true);
      } else {
        const result = await apiRequest<{ resume: Resume }>(`/api/resumes/${encodeURIComponent(id!)}`, {
          method: "PATCH",
          body: JSON.stringify({ title: title.trim(), templateId, data: resumeData, ...(version ? { baseVersion: version } : {}) }),
        });
        setVersion(result.resume.version);
        setSaved(true);
      }
    } catch (reason) { setError(reason); }
    finally { setSaving(false); }
  }

  async function draftWithAi() {
    const fullName = data.personalInfo.fullName.trim();
    if (!fullName) {
      setGenerationError("Add your full name in the contact section before asking for an AI draft.");
      return;
    }
    setGenerationError("");
    setGenerating(true);
    try {
      const profile = {
        personalInfo: { ...data.personalInfo, fullName },
        experience: data.experience.map((entry) => ({
          company: entry.company ?? "",
          title: entry.title ?? "",
          location: entry.location ?? "",
          startDate: entry.startDate ?? "",
          endDate: entry.current ? "" : entry.endDate ?? "",
          current: Boolean(entry.current),
          description: (entry.description ?? "").replace(/<[^>]*>/g, " ").trim(),
        })),
        education: data.education,
        skills: data.skills.flatMap((group) => group.items.map((item) => item.trim().slice(0, 60)).filter(Boolean)),
        projects: data.projects.map((project) => ({ ...project, technologies: project.technologies.map((item) => item.slice(0, 60)) })),
        certifications: data.certifications,
        achievements: data.achievements,
      };
      const result = await apiRequest<{ resume: Resume }>("/api/resumes/generate", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim() || `${fullName}'s resume`,
          templateId,
          ...(targetRole.trim() ? { targetRole: targetRole.trim() } : {}),
          profile,
        }),
      });
      router.replace(`/resumes/${result.resume._id}/edit`);
    } catch (reason) {
      setGenerationError(errorMessage(reason, "AI resume drafting failed. You can continue with the manual editor below."));
    } finally {
      setGenerating(false);
    }
  }

  function setPersonal(field: keyof ResumeData["personalInfo"], value: string) {
    setData((current) => ({ ...current, personalInfo: { ...current.personalInfo, [field]: value } }));
  }
  function setExperience(index: number, field: keyof ResumeData["experience"][number], value: string | boolean) {
    setData((current) => ({ ...current, experience: current.experience.map((entry, itemIndex) => itemIndex === index ? { ...entry, [field]: value } : entry) }));
  }
  function setEducation(index: number, field: keyof ResumeData["education"][number], value: string) {
    setData((current) => ({ ...current, education: current.education.map((entry, itemIndex) => itemIndex === index ? { ...entry, [field]: value } : entry) }));
  }
  function setProject(index: number, field: keyof ResumeData["projects"][number], value: string | string[]) {
    setData((current) => ({ ...current, projects: current.projects.map((entry, itemIndex) => itemIndex === index ? { ...entry, [field]: value } : entry) }));
  }
  function setCertification(index: number, field: keyof ResumeData["certifications"][number], value: string) {
    setData((current) => ({ ...current, certifications: current.certifications.map((entry, itemIndex) => itemIndex === index ? { ...entry, [field]: value } : entry) }));
  }
  const experience = data.experience;

  if (loading) return <LoadingCard label="Opening resume editor " />;
  if (error && mode === "edit" && !version) return <ErrorCard error={error} retry={() => window.location.reload()} />;
  return <>
    <div className="editor-header"><div><Link className="text-link" href="/resumes">&larr; Resume library</Link><h1>{mode === "create" ? "A clear story starts here." : "Refine your story."}</h1><p>Keep it accurate, specific, and yours. Your resume is saved to your account.</p></div>{mode === "edit" && id && <Link className="button button-outline" href={`/resumes/${id}/preview`}>Preview resume</Link>}</div>
    {error && <div className="alert alert-error" role="alert">{errorMessage(error)}</div>}
    {saved && <div className="alert alert-success" role="status">Saved   your latest version is up to date.</div>}
    {mode === "create" && <section className="ai-draft-card">
      <div><span className="eyebrow">OPTIONAL, OPERATOR-CONFIGURED</span><h2>Want help drafting the prose?</h2><p>Give the editor your facts first, then ask the configured AI provider to shape the wording. Your facts remain yours to review.</p></div>
      <label className="field">Target role <span className="optional">(optional)</span><input value={targetRole} onChange={(event) => setTargetRole(event.target.value)} maxLength={120} placeholder="e.g. Senior product designer" /></label>
      {generationError && <div className="ai-generation-error"><div className="alert alert-error" role="alert">{generationError}</div><Link className="text-link" href="#resume-manual-editor">Continue with manual resume creation  </Link></div>}
      <button type="button" className="button button-outline" onClick={() => void draftWithAi()} disabled={generating}>{generating ? "Asking configured provider " : "Draft with AI"}</button>
      <p className="field-hint">AI requires an operator-configured provider. If unavailable, the API response is shown and manual editing remains available.</p>
    </section>}
    <form className="editor-form" onSubmit={save}>
      <section className="editor-section" id="resume-manual-editor"><div className="editor-section-heading"><span>01</span><div><h2>Document details</h2><p>Start with a name for this draft.</p></div></div>
        <div className="editor-fields two-col"><label className="field">Resume title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} required placeholder="Product designer - 2026" /></label>
          <label className="field">Style<select value={templateId} onChange={(event) => setTemplateId(event.target.value)}><option value="modern">Modern</option><option value="ats-classic">ATS classic</option></select></label></div>
      </section>
      <section className="editor-section"><div className="editor-section-heading"><span>02</span><div><h2>How to reach you</h2><p>Use the contact details you want employers to see.</p></div></div>
        <div className="editor-fields two-col"><label className="field">Full name<input required value={data.personalInfo.fullName} onChange={(event) => setPersonal("fullName", event.target.value)} maxLength={120} placeholder="Jordan Lee" /></label>
          <label className="field">Email<input type="email" value={data.personalInfo.email} onChange={(event) => setPersonal("email", event.target.value)} maxLength={254} placeholder="you@example.com" /></label>
          <label className="field">Phone<input type="tel" value={data.personalInfo.phone} onChange={(event) => setPersonal("phone", event.target.value)} maxLength={30} placeholder="+1 555 010 2000" /></label>
          <label className="field">Location<input value={data.personalInfo.location} onChange={(event) => setPersonal("location", event.target.value)} maxLength={120} placeholder="City, region" /></label>
          <label className="field">LinkedIn URL<input type="url" value={data.personalInfo.linkedin} onChange={(event) => setPersonal("linkedin", event.target.value)} placeholder="https://linkedin.com/in/ " /></label>
          <label className="field">Website<input type="url" value={data.personalInfo.website} onChange={(event) => setPersonal("website", event.target.value)} placeholder="https://yourportfolio.com" /></label>
        </div>
      </section>
      <section className="editor-section"><div className="editor-section-heading"><span>03</span><div><h2>Professional summary</h2><p>A few sentences about your work, strengths, and direction.</p></div></div>
        <RichEditor label="Professional summary" value={data.summary} onChange={(summary) => setData((current) => ({ ...current, summary }))} />
      </section>
      <section className="editor-section"><div className="editor-section-heading"><span>04</span><div><h2>Experience</h2><p>Lead with outcomes and concrete examples.</p></div></div>
        {experience.map((entry, index) => <div className="repeat-card" key={`experience-${index}`}><div className="repeat-card-heading"><strong>Role {index + 1}</strong><button type="button" className="danger-text" onClick={() => setData((current) => ({ ...current, experience: current.experience.filter((_, i) => i !== index) }))}>Remove</button></div>
          <div className="editor-fields two-col"><label className="field">Job title<input value={entry.title ?? ""} onChange={(event) => setExperience(index, "title", event.target.value)} maxLength={150} /></label>
            <label className="field">Company<input value={entry.company ?? ""} onChange={(event) => setExperience(index, "company", event.target.value)} maxLength={150} /></label>
            <label className="field">Location<input value={entry.location ?? ""} onChange={(event) => setExperience(index, "location", event.target.value)} maxLength={120} /></label>
            <label className="field">Start date <input type="month" value={entry.startDate ?? ""} onChange={(event) => setExperience(index, "startDate", event.target.value)} /></label>
            <label className="field">End date <input type="month" value={entry.endDate ?? ""} onChange={(event) => setExperience(index, "endDate", event.target.value)} disabled={entry.current} /></label>
            <label className="check-field"><input type="checkbox" checked={Boolean(entry.current)} onChange={(event) => setExperience(index, "current", event.target.checked)} /> I currently work here</label>
          </div><div className="field"><span className="field-label">Highlights</span><RichEditor label={`Experience highlights ${index + 1}`} value={entry.description ?? ""} onChange={(description) => setExperience(index, "description", description)} /></div>
        </div>)}
        <button type="button" className="button button-outline" onClick={() => setData((current) => ({ ...current, experience: [...current.experience, { company: "", title: "", location: "", startDate: "", endDate: "", current: false, description: "" }] }))}>+ Add experience</button>
      </section>
      <section className="editor-section"><div className="editor-section-heading"><span>05</span><div><h2>Education</h2><p>Add the education details you want to include.</p></div></div>
        {data.education.map((entry, index) => <div className="repeat-card" key={`education-${index}`}><div className="repeat-card-heading"><strong>Education {index + 1}</strong><button type="button" className="danger-text" onClick={() => setData((current) => ({ ...current, education: current.education.filter((_, i) => i !== index) }))}>Remove</button></div>
          <div className="editor-fields two-col"><label className="field">Institution<input value={entry.institution} onChange={(event) => setEducation(index, "institution", event.target.value)} maxLength={150} /></label>
            <label className="field">Degree<input value={entry.degree} onChange={(event) => setEducation(index, "degree", event.target.value)} maxLength={150} /></label>
            <label className="field">Field of study<input value={entry.field} onChange={(event) => setEducation(index, "field", event.target.value)} maxLength={150} /></label>
            <label className="field">Grade / honors<input value={entry.grade} onChange={(event) => setEducation(index, "grade", event.target.value)} maxLength={50} /></label>
            <label className="field">Start date<input type="month" value={entry.startDate} onChange={(event) => setEducation(index, "startDate", event.target.value)} /></label>
            <label className="field">End date<input type="month" value={entry.endDate} onChange={(event) => setEducation(index, "endDate", event.target.value)} /></label></div>
          <div className="field"><span className="field-label">Notes (optional)</span><RichEditor label={`Education notes ${index + 1}`} value={entry.description} onChange={(description) => setEducation(index, "description", description)} /></div>
        </div>)}
        <button type="button" className="button button-outline" onClick={() => setData((current) => ({ ...current, education: [...current.education, { institution: "", degree: "", field: "", startDate: "", endDate: "", grade: "", description: "" }] }))}>+ Add education</button>
      </section>
      <section className="editor-section"><div className="editor-section-heading"><span>06</span><div><h2>Projects</h2><p>Show a project that helps illustrate your work.</p></div></div>
        {data.projects.map((entry, index) => <div className="repeat-card" key={`project-${index}`}><div className="repeat-card-heading"><strong>Project {index + 1}</strong><button type="button" className="danger-text" onClick={() => setData((current) => ({ ...current, projects: current.projects.filter((_, i) => i !== index) }))}>Remove</button></div>
          <div className="editor-fields two-col"><label className="field">Project name<input value={entry.name} onChange={(event) => setProject(index, "name", event.target.value)} maxLength={150} /></label>
            <label className="field">Project URL<input type="url" value={entry.url} onChange={(event) => setProject(index, "url", event.target.value)} placeholder="https://..." /></label>
            <label className="field">Technologies <span className="optional">(comma-separated)</span><input value={entry.technologies.join(", ")} onChange={(event) => setProject(index, "technologies", event.target.value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30))} /></label></div>
          <div className="field"><span className="field-label">Description</span><RichEditor label={`Project description ${index + 1}`} value={entry.description} onChange={(description) => setProject(index, "description", description)} /></div>
        </div>)}
        <button type="button" className="button button-outline" onClick={() => setData((current) => ({ ...current, projects: [...current.projects, { name: "", url: "", technologies: [], description: "" }] }))}>+ Add project</button>
      </section>
      <section className="editor-section"><div className="editor-section-heading"><span>07</span><div><h2>Certifications</h2><p>Include credentials relevant to the roles you want.</p></div></div>
        {data.certifications.map((entry, index) => <div className="repeat-card" key={`certification-${index}`}><div className="repeat-card-heading"><strong>Certification {index + 1}</strong><button type="button" className="danger-text" onClick={() => setData((current) => ({ ...current, certifications: current.certifications.filter((_, i) => i !== index) }))}>Remove</button></div>
          <div className="editor-fields two-col"><label className="field">Name<input value={entry.name} onChange={(event) => setCertification(index, "name", event.target.value)} maxLength={150} /></label>
            <label className="field">Issuing organization<input value={entry.issuer} onChange={(event) => setCertification(index, "issuer", event.target.value)} maxLength={150} /></label>
            <label className="field">Date<input type="month" value={entry.date} onChange={(event) => setCertification(index, "date", event.target.value)} /></label>
            <label className="field">Credential URL<input type="url" value={entry.url} onChange={(event) => setCertification(index, "url", event.target.value)} placeholder="https://..." /></label></div>
        </div>)}
        <button type="button" className="button button-outline" onClick={() => setData((current) => ({ ...current, certifications: [...current.certifications, { name: "", issuer: "", date: "", url: "" }] }))}>+ Add certification</button>
      </section>
      <section className="editor-section"><div className="editor-section-heading"><span>08</span><div><h2>Achievements</h2><p>Capture awards or measurable milestones, in your own words.</p></div></div>
        {data.achievements.map((achievement, index) => <div className="achievement-row" key={`achievement-${index}`}><label className="field"><span className="sr-only">Achievement {index + 1}</span><input value={achievement} maxLength={300} onChange={(event) => setData((current) => ({ ...current, achievements: current.achievements.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} placeholder="Achievement or milestone" /></label><button type="button" className="danger-text" onClick={() => setData((current) => ({ ...current, achievements: current.achievements.filter((_, i) => i !== index) }))}>Remove</button></div>)}
        <button type="button" className="button button-outline" onClick={() => setData((current) => ({ ...current, achievements: [...current.achievements, ""] }))}>+ Add achievement</button>
      </section>
      <section className="editor-section"><div className="editor-section-heading"><span>09</span><div><h2>Skills</h2><p>Add the skills you are comfortable discussing.</p></div></div>
        <label className="field">Skills <span className="optional">Separate with commas</span><input value={data.skills.flatMap((group) => group.items).join(", ")} onChange={(event) => setData((current) => ({ ...current, skills: event.target.value.trim() ? [{ category: "Skills", items: event.target.value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 60) }] : [] }))} maxLength={1800} placeholder="Product strategy, research, Figma " /></label>
      </section>
      <div className="editor-submit"><span>{saved ? "Changes saved to your account" : "Your draft stays private to your account."}</span><button className="button button-primary" disabled={saving}>{saving ? "Saving " : mode === "create" ? "Save resume" : "Save changes"}</button></div>
    </form>
  </>;
}

export function ResumePreviewView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [html, setHtml] = useState("");
  const [title, setTitle] = useState("Resume preview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      const [content, response] = await Promise.all([
        apiRequest<string>(`/api/resumes/${encodeURIComponent(id)}/preview`, {}, { responseType: "text" }),
        apiRequest<{ resume: Resume }>(`/api/resumes/${encodeURIComponent(id)}`),
      ]);
      setHtml(content);
      setTitle(response.resume.title);
      setError(null);
    } catch (reason) { setError(reason); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);
  function download() {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "resume"}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return <>
    <div className="editor-header"><div><Link className="text-link" href={`/resumes/${id}/edit`}>&larr; Back to editing</Link><h1>{title}</h1><p>Print this page or save it as a PDF from your browser&apos;s print dialog.</p></div><div className="button-row"><button className="button button-outline" onClick={download} disabled={!html}>Download HTML</button><button className="button button-primary" onClick={() => (document.getElementById("resume-preview") as HTMLIFrameElement | null)?.contentWindow?.print()} disabled={!html}>Print / Save PDF</button></div></div>
    {loading ? <LoadingCard label="Preparing your preview..." /> : error ? <ErrorCard error={error} retry={() => void load()} /> : !html ? <div className="empty-state"><h2>Nothing to preview yet</h2><Link className="button button-primary" href={`/resumes/${id}/edit`}>Return to editor</Link></div> : <iframe id="resume-preview" className="resume-frame" title={`${title} preview`} sandbox="allow-same-origin" srcDoc={html} />}
  </>;
}

export function ConsultationsView() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try { const result = await apiRequest<{ bookings: Booking[] }>("/api/bookings?page=1&limit=50&sort=startAt&order=desc"); setBookings(result.bookings); setError(null); }
    catch (reason) { setError(reason); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);
  async function cancel(id: string) {
    if (!window.confirm("Cancel this consultation booking?")) return;
    try { await apiRequest(`/api/bookings/${id}/cancel`, { method: "POST", body: JSON.stringify({}) }); await load(); }
    catch (reason) { setError(reason); }
  }
  return <>
    <PageHeading eyebrow="CONSULTATIONS" title="Make room for a conversation." description="See your consultation requests and confirmed sessions in one place." action={<Link href="/consultations/book" className="button button-primary">Find a time</Link>} />
    {error && <ErrorCard error={error} retry={() => void load()} />}
    {loading ? <LoadingCard label="Loading consultations " /> : bookings.length ? <div className="booking-list">{bookings.map((booking) => <article className="booking-card" key={booking.id}>
      <div className="booking-date"><strong>{new Date(booking.startAt).toLocaleDateString(undefined, { day: "2-digit" })}</strong><span>{new Date(booking.startAt).toLocaleDateString(undefined, { month: "short" })}</span></div>
      <div className="booking-info"><h2>Career consultation</h2><p>with {booking.consultantName}</p><span>{new Date(booking.startAt).toLocaleString()} - {new Date(booking.endAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>
      <div className="booking-actions"><span className={`status-pill status-${booking.state.toLowerCase()}`}>{booking.state.replaceAll("_", " ")}</span>{booking.meetingUrl && <a className="text-link" href={booking.meetingUrl} target="_blank" rel="noreferrer">Meeting link &rarr;</a>}{booking.state === "PENDING_PAYMENT" && booking.checkoutUrl && <a className="text-link" href={booking.checkoutUrl}>Continue to provider &rarr;</a>}{["PENDING_PAYMENT", "CONFIRMED"].includes(booking.state) && <button className="danger-text" onClick={() => void cancel(booking.id)}>Cancel booking</button>}</div>
    </article>)}</div> : <div className="empty-state"><span className="empty-illustration">&#9719;</span><h2>No consultations yet</h2><p>Consultant availability and booking options appear here when they are configured by the platform operator.</p><Link href="/consultations/book" className="button button-primary">Browse availability</Link></div>}
    <div className="notice notice-soft"><strong>Payments and scheduling</strong><span>Checkout, calendar invitations, and meeting links require the platform s payment and scheduling providers. The booking service will explain if those providers are not configured.</span></div>
  </>;
}

export function BookConsultationView() {
  const { user } = useAuth();
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [selectedConsultant, setSelectedConsultant] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [resultMessage, setResultMessage] = useState("");
  const [profile, setProfile] = useState<ApiUser | null>(null);
  const router = useRouter();
  useEffect(() => {
    let active = true;
    Promise.all([apiRequest<{ consultants: Consultant[] }>("/api/consultants"), apiRequest<{ user: ApiUser }>("/api/users/me")])
      .then(([consultantData, userData]) => {
        if (!active) return;
        setConsultants(consultantData.consultants);
        setProfile(userData.user);
        if (consultantData.consultants[0]?.id) setSlotsLoading(true);
        setSelectedConsultant(consultantData.consultants[0]?.id ?? "");
      })
      .catch((reason) => { if (active) setError(reason); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!selectedConsultant) return;
    let active = true;
    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + 30);
    apiRequest<{ availability: Slot[] }>(`/api/consultants/${encodeURIComponent(selectedConsultant)}/availability?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)
      .then((data) => { if (active) setSlots(data.availability.filter((slot) => slot.available)); })
      .catch((reason) => { if (active) setError(reason); })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [selectedConsultant]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResultMessage("");
    if (!selectedSlot) { setError(new ApiError("Choose one available time before booking.", 400)); return; }
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      const result = await apiRequest<{ booking: Booking }>("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          consultantId: selectedConsultant,
          startAt: selectedSlot,
          clientName: String(form.get("clientName") ?? "").trim(),
          clientEmail: String(form.get("clientEmail") ?? "").trim(),
          clientPhone: String(form.get("clientPhone") ?? "").trim(),
          agenda: String(form.get("agenda") ?? "").trim(),
        }),
      });
      if (result.booking.checkoutUrl) {
        setResultMessage("Your time was reserved. Continue with the configured payment provider.");
        window.location.assign(result.booking.checkoutUrl);
      } else {
        setResultMessage("Your request was received. Check consultations for the latest booking status.");
        router.push("/consultations");
      }
    } catch (reason) { setError(reason); }
    finally { setSubmitting(false); }
  }

  return <>
    <div className="editor-header"><div><Link className="text-link" href="/consultations">&larr; Consultations</Link><h1>Find time for a conversation.</h1><p>Choose from the availability shared by career consultants.</p></div></div>
    {loading ? <LoadingCard label="Looking for consultants..." /> : error && !consultants.length ? <ErrorCard error={error} retry={() => router.refresh()} /> : !consultants.length ? <div className="empty-state"><span className="empty-illustration">&#9719;</span><h2>No consultant profiles yet</h2><p>Bookings will be available when the platform operator adds consultant profiles and availability.</p><Link className="button button-outline" href="/consultations">Back to consultations</Link></div> : <>
      <div className="notice notice-soft"><strong>Before you book</strong><span>Payment, calendar, and email providers must be configured by the platform operator. You will see an error if an integration is not ready.</span></div>
      {error && <div className="alert alert-error" role="alert">{errorMessage(error)}</div>}
      {resultMessage && <div className="alert alert-success" role="status">{resultMessage}</div>}
      <form className="booking-form" onSubmit={submit}>
        <section className="editor-section"><div className="editor-section-heading"><span>01</span><div><h2>Choose a consultant</h2><p>Times are displayed in your browser local timezone.</p></div></div>
          <label className="field">Career consultant<select required value={selectedConsultant} onChange={(event) => { setSlots([]); setSelectedSlot(""); setSlotsLoading(true); setError(null); setSelectedConsultant(event.target.value); }}>{consultants.map((consultant) => <option key={consultant.id} value={consultant.id}>{consultant.name} - {consultant.timeZone}</option>)}</select></label>
          <div className="field"><span className="field-label">Available times</span>{slotsLoading ? <p className="field-hint">Checking availability...</p> : slots.length ? <div className="slot-grid">{slots.map((slot) => <label className={`slot-choice ${selectedSlot === slot.startAt ? "selected" : ""}`} key={slot.startAt}><input type="radio" name="slot" value={slot.startAt} checked={selectedSlot === slot.startAt} onChange={() => setSelectedSlot(slot.startAt)} /><span>{new Date(slot.startAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}<strong>{new Date(slot.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong></span></label>)}</div> : <p className="field-hint">No available times are listed in the next 30 days.</p>}</div>
        </section>
        <section className="editor-section"><div className="editor-section-heading"><span>02</span><div><h2>Your details</h2><p>These details are shared with the selected consultant.</p></div></div>
          <div className="editor-fields two-col"><label className="field">Name<input name="clientName" defaultValue={profile?.name ?? user?.name ?? ""} required maxLength={120} /></label><label className="field">Email<input name="clientEmail" type="email" defaultValue={profile?.email ?? user?.email ?? ""} required maxLength={254} /></label><label className="field">Phone<input name="clientPhone" type="tel" defaultValue={profile?.phone ?? ""} required minLength={5} maxLength={30} /></label></div>
          <label className="field">What would you like to discuss?<textarea name="agenda" required maxLength={2000} rows={4} placeholder="Share a little context to help make the conversation useful." /></label>
        </section>
        <div className="editor-submit"><span>Availability can change until a slot is reserved.</span><button className="button button-primary" disabled={submitting || slotsLoading || !slots.length}>{submitting ? "Requesting..." : "Request this time"}</button></div>
      </form>
    </>}
  </>;
}

export function BookingReturnView({ mode }: { mode: "success" | "cancel" }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ bookings: Booking[] }>("/api/bookings?page=1&limit=5&sort=createdAt&order=desc");
      setBookings(result.bookings);
      setError(null);
    } catch (reason) { setError(reason); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);
  const success = mode === "success";
  return <>
    <PageHeading eyebrow="BOOKING STATUS" title={success ? "Checkout return received." : "Checkout was interrupted."} description={success ? "The booking service must verify payment from Stripe's server-side webhook before a booking can be treated as paid." : "The checkout page returned you here. This redirect alone does not cancel a booking or change its status."} />
    <div className={`return-panel ${success ? "return-success" : "return-cancel"}`}>
      <span className="return-mark" aria-hidden="true">{success ? "..." : "!"}</span>
      <div><h2>{success ? "Waiting for booking confirmation" : "No payment confirmation was received here"}</h2>
        <p>{success ? "A success URL is not proof of payment. The states below come only from the authenticated booking API; Stripe's verified webhook is the source of payment truth." : "Your booking may still be pending payment. Check its server-recorded state below before requesting another time, or contact support if it stays pending."}</p>
      </div>
    </div>
    <div className="section-title-row"><div><p className="eyebrow">FROM YOUR ACCOUNT</p><h2>Most recent booking states</h2></div><button className="button button-outline button-small" onClick={() => { setLoading(true); void load(); }} disabled={loading}>{loading ? "Refreshing..." : "Refresh status"}</button></div>
    {error ? <ErrorCard error={error} retry={() => { setLoading(true); void load(); }} /> : loading ? <LoadingCard label="Checking booking status with the server..." /> : bookings.length ? <div className="booking-list">{bookings.map((booking) => <article className="booking-card" key={booking.id}>
      <div className="booking-date"><strong>{new Date(booking.startAt).toLocaleDateString(undefined, { day: "2-digit" })}</strong><span>{new Date(booking.startAt).toLocaleDateString(undefined, { month: "short" })}</span></div>
      <div className="booking-info"><h2>Consultation with {booking.consultantName}</h2><p>{new Date(booking.startAt).toLocaleString()}</p></div>
      <div className="booking-actions"><span className={`status-pill status-${booking.state.toLowerCase()}`}>{booking.state.replaceAll("_", " ")}</span></div>
    </article>)}</div> : <div className="empty-state"><h2>No booking is listed yet</h2><p>It may take a moment for the booking service to respond. Refresh to check again, or open consultations to view your account.</p><Link className="button button-outline" href="/consultations">View consultations</Link></div>}
    <div className="notice notice-soft"><strong>Important</strong><span>This return page never changes a booking or declares payment successful. Payment state is determined only by the booking service after it verifies the Stripe webhook.</span></div>
    <div className="button-row"><Link className="button button-primary" href="/consultations">Go to consultations</Link><Link className="button button-outline" href="/dashboard">Back to dashboard</Link></div>
  </>;
}

export function ProfileView() {
  const { updateUser } = useAuth();
  const [profile, setProfile] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ user: ApiUser }>("/api/users/me");
      setProfile(result.user);
      setError(null);
    } catch (reason) { setError(reason); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    const payload = {
      name: profile.name.trim(),
      ...(profile.phone?.trim() ? { phone: profile.phone.trim() } : {}),
      profile: {
        headline: profile.profile?.headline ?? "",
        bio: profile.profile?.bio ?? "",
        location: profile.profile?.location ?? "",
        skills: profile.profile?.skills ?? [],
      },
    };
    try {
      const result = await apiRequest<{ user: ApiUser }>("/api/users/me", { method: "PATCH", body: JSON.stringify(payload) });
      setProfile(result.user);
      updateUser(result.user);
      setSaved(true);
    } catch (reason) { setError(reason); }
    finally { setSaving(false); }
  }

  if (loading) return <LoadingCard label="Loading your profile..." />;
  if (error && !profile) return <ErrorCard error={error} retry={() => void load()} />;
  if (!profile) return <div className="empty-state"><h2>Profile unavailable</h2><p>Your account profile could not be loaded.</p><button className="button button-outline" onClick={() => void load()}>Try again</button></div>;
  return <>
    <PageHeading eyebrow="PROFILE & SETTINGS" title="Your details, your direction." description="Update the contact and career-profile information attached to your account." />
    {error && <div className="alert alert-error" role="alert">{errorMessage(error)}</div>}
    {saved && <div className="alert alert-success" role="status">Your profile was updated.</div>}
    <form className="editor-form" onSubmit={submit}>
      <section className="editor-section"><div className="editor-section-heading"><span>01</span><div><h2>Account details</h2><p>Your email is used to sign in and cannot be changed here.</p></div></div>
        <div className="editor-fields two-col"><label className="field">Full name<input required value={profile.name} maxLength={100} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label>
          <label className="field">Email address<input value={profile.email} disabled readOnly /></label>
          <label className="field">Phone<input type="tel" value={profile.phone ?? ""} maxLength={15} pattern="\+?[0-9\s-]{7,15}" onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></label>
          <label className="field">Account role<input value={profile.role ?? "USER"} disabled readOnly /></label></div>
      </section>
      <section className="editor-section"><div className="editor-section-heading"><span>02</span><div><h2>Career profile</h2><p>Add context for your workspace. Role permissions are managed by the server.</p></div></div>
        <div className="editor-fields two-col"><label className="field">Headline<input value={profile.profile?.headline ?? ""} maxLength={150} placeholder="e.g. Product designer focused on accessible tools" onChange={(event) => setProfile({ ...profile, profile: { ...profile.profile, headline: event.target.value } })} /></label>
          <label className="field">Location<input value={profile.profile?.location ?? ""} maxLength={100} placeholder="City, region" onChange={(event) => setProfile({ ...profile, profile: { ...profile.profile, location: event.target.value } })} /></label></div>
        <label className="field">About<textarea value={profile.profile?.bio ?? ""} maxLength={2000} rows={5} placeholder="A few sentences about your current focus..." onChange={(event) => setProfile({ ...profile, profile: { ...profile.profile, bio: event.target.value } })} /></label>
        <label className="field">Skills <span className="optional">(separate with commas; up to 50)</span><input value={profile.profile?.skills?.join(", ") ?? ""} onChange={(event) => setProfile({ ...profile, profile: { ...profile.profile, skills: event.target.value.split(",").map((skill) => skill.trim().slice(0, 50)).filter(Boolean).slice(0, 50) } })} placeholder="Research, facilitation, Python..." /></label>
      </section>
      <div className="editor-submit"><span>Only contact and profile fields can be changed here. Role is server-managed.</span><button className="button button-primary" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button></div>
    </form>
  </>;
}