import { JWT } from 'google-auth-library';
import { config } from '../config';
import { ConfigurationError } from '../errors';

export interface CalendarRequest {
  bookingId: string;
  summary: string;
  description: string;
  attendeeEmail: string;
  startAt: Date;
  endAt: Date;
  timeZone: string;
}

export interface CalendarResult {
  eventId: string;
  meetingUrl: string;
  startAt: Date;
  endAt: Date;
}

export interface CalendarProvider {
  createEvent(request: CalendarRequest): Promise<CalendarResult>;
}

function deterministicEventId(bookingId: string): string {
  const bytes = Buffer.from(bookingId.replace(/[^a-f0-9]/gi, ''), 'hex');
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  let bits = 0;
  let value = 0;
  let output = 'b';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

export class GoogleCalendarAdapter implements CalendarProvider {
  async createEvent(request: CalendarRequest): Promise<CalendarResult> {
    const { GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_CALENDAR_ID } = config;
    if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_CALENDAR_ID) {
      throw new ConfigurationError('Google Calendar');
    }
    const auth = new JWT({
      email: GOOGLE_CLIENT_EMAIL,
      key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
    });
    const token = await auth.getAccessToken();
    if (!token.token) throw new Error('Google authentication did not return an access token');
    const eventId = deterministicEventId(request.bookingId);
    const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events`;
    const eventBody = {
      id: eventId,
      summary: request.summary,
      description: request.description,
      start: { dateTime: request.startAt.toISOString(), timeZone: request.timeZone },
      end: { dateTime: request.endAt.toISOString(), timeZone: request.timeZone },
      attendees: [{ email: request.attendeeEmail }],
      conferenceData: {
        createRequest: {
          requestId: `booking-${request.bookingId}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      extendedProperties: { private: { bookingId: request.bookingId } },
    };
    try {
      const response = await fetch(`${calendarUrl}?conferenceDataVersion=1`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      });
      if (response.status === 409) return this.getExisting(calendarUrl, eventId, token.token, request);
      if (!response.ok) throw new Error(`Google Calendar returned HTTP ${response.status}`);
      return this.toResult((await response.json()) as GoogleEvent, eventId, request);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 409) throw error;
      return this.getExisting(calendarUrl, eventId, token.token, request);
    }
  }

  private async getExisting(calendarUrl: string, eventId: string, token: string, request: CalendarRequest) {
    const response = await fetch(`${calendarUrl}/${encodeURIComponent(eventId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Google Calendar lookup returned HTTP ${response.status}`);
    return this.toResult((await response.json()) as GoogleEvent, eventId, request);
  }

  private toResult(event: GoogleEvent, fallbackId: string, request: CalendarRequest): CalendarResult {
    const meetingUrl =
      event.hangoutLink ??
      event.conferenceData?.entryPoints?.find((entryPoint) => entryPoint.entryPointType === 'video')?.uri;
    if (!meetingUrl) {
      throw new Error('Google Calendar has not generated the meeting URL yet');
    }
    return {
      eventId: event.id ?? fallbackId,
      meetingUrl,
      startAt: new Date(event.start?.dateTime ?? request.startAt),
      endAt: new Date(event.end?.dateTime ?? request.endAt),
    };
  }
}

interface GoogleEvent {
  id?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  start?: { dateTime?: string };
  end?: { dateTime?: string };
}
