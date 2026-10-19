'use client';
import MainSection from '@/components/MainSection';
import PublishZap from '@/components/PublishZap';
import { useSearchParams } from 'next/navigation';
import React, { Suspense } from 'react';

function EditorContent() {
  const searchParams = useSearchParams();
  const zapId: string | null = searchParams.get('zapId');

  return (
    <MainSection>
      <div className="editor-view canvas">
        <PublishZap zapId={zapId ?? ''} />
      </div>
    </MainSection>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="editor-loading">Loading...</div>}>
      <EditorContent />
    </Suspense>
  );
}
