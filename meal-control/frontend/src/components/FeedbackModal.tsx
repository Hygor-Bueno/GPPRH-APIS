import React, { useEffect } from 'react';

interface Props {
  type: 'success' | 'error';
  message: string;
  employeeName?: string;
  onDismiss: () => void;
}

export default function FeedbackModal({ type, message, employeeName, onDismiss }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className={`feedback-overlay ${type}`} onClick={onDismiss}>
      <div className="feedback-icon">{type === 'success' ? '✅' : '❌'}</div>
      {employeeName && <div className="feedback-employee">{employeeName}</div>}
      <div className="feedback-message">{message}</div>
      <button className="feedback-dismiss" onClick={onDismiss}>
        Continuar
      </button>
    </div>
  );
}
