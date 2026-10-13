import { Schema, model } from 'mongoose';

// Messages live in their own collection (not embedded in the session): a conversation is
// unbounded, so embedding would hit the 16 MB document limit and make every append rewrite a big doc.
const chatMessageSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, maxlength: 20000 },
    model: { type: String },
    usage: {
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Serves "last N messages of a session, in order" (context building + opening a chat).
// _id is the tiebreaker: two messages saved in the same millisecond keep insertion order.
chatMessageSchema.index({ sessionId: 1, createdAt: 1, _id: 1 });

chatMessageSchema.set('toJSON', {
  transform: (_doc, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const ChatMessage = model('ChatMessage', chatMessageSchema);
