import { Schema, model } from 'mongoose';

export const DEFAULT_TITLE = 'New chat';

const chatSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, trim: true, maxlength: 100, default: DEFAULT_TITLE },
    // Denormalised counters: cheap to read for the dashboard / sidebar, updated with $inc.
    messageCount: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    lastMessageAt: { type: Date },
  },
  { timestamps: true },
);

// Serves "list my sessions, newest activity first" (the sidebar query) and the dashboard count.
chatSessionSchema.index({ userId: 1, updatedAt: -1 });

chatSessionSchema.set('toJSON', {
  transform: (_doc, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const ChatSession = model('ChatSession', chatSessionSchema);
