"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

export function RichEditor({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value || "",
    immediatelyRender: false,
    editorProps: {
      attributes: { "aria-label": label, class: "rich-editor-content" },
    },
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
  });

  useEffect(() => {
    if (editor && editor.getHTML() !== (value || "")) editor.commands.setContent(value || "");
  }, [editor, value]);

  return (
    <div className="rich-editor">
      <div className="editor-toolbar" aria-label={`${label} formatting`}>
        <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()} aria-label="Bold" aria-pressed={editor?.isActive("bold") ?? false}>B</button>
        <button type="button" onClick={() => editor?.chain().focus().toggleItalic().run()} aria-label="Italic" aria-pressed={editor?.isActive("italic") ?? false}><i>I</i></button>
        <button type="button" onClick={() => editor?.chain().focus().toggleBulletList().run()} aria-label="Bullet list" aria-pressed={editor?.isActive("bulletList") ?? false}>• List</button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
