import React, { useEffect, useRef, useState, useCallback } from 'react';
import QrScanner from 'qr-scanner';
import Nav from '../components/Nav';
import FeedbackModal from '../components/FeedbackModal';
import { scanMeal } from '../api';

type FeedbackState = {
  type: 'success' | 'error';
  message: string;
  employeeName?: string;
} | null;

export default function Scanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [operator, setOperator] = useState(() => localStorage.getItem('operator') || '');
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const processingRef = useRef(false);

  const handleResult = useCallback(async (result: QrScanner.ScanResult) => {
    if (processingRef.current) return;
    processingRef.current = true;
    scannerRef.current?.stop();
    setRunning(false);

    try {
      const data = await scanMeal(result.data, operator || 'operador');
      setFeedback({
        type: data.ok ? 'success' : 'error',
        message: data.message,
        employeeName: data.employee?.name,
      });
    } catch {
      setFeedback({ type: 'error', message: 'Erro de conexão com o servidor' });
    }
  }, [operator]);

  const startScanner = useCallback(async () => {
    if (!videoRef.current) return;
    if (scannerRef.current) {
      scannerRef.current.destroy();
      scannerRef.current = null;
    }
    const scanner = new QrScanner(
      videoRef.current,
      handleResult,
      {
        preferredCamera: 'environment',
        highlightScanRegion: true,
        highlightCodeOutline: true,
      }
    );
    scannerRef.current = scanner;
    await scanner.start();
    setRunning(true);
  }, [handleResult]);

  const stopScanner = useCallback(() => {
    scannerRef.current?.stop();
    setRunning(false);
  }, []);

  useEffect(() => {
    return () => { scannerRef.current?.destroy(); };
  }, []);

  const handleDismiss = useCallback(() => {
    setFeedback(null);
    processingRef.current = false;
  }, []);

  const handleOperatorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setOperator(e.target.value);
    localStorage.setItem('operator', e.target.value);
  };

  return (
    <>
      <Nav />
      <main className="scanner-page">
        <div className="scanner-operator">
          <label>Seu nome (operador)</label>
          <input
            type="text"
            placeholder="Ex: Maria"
            value={operator}
            onChange={handleOperatorChange}
          />
        </div>

        <div className="scanner-box">
          <video ref={videoRef} />
        </div>

        <p className="scanner-hint">
          {running ? '🔍 Aponte a câmera para o QR Code do colaborador' : 'Pressione Iniciar para ativar a câmera'}
        </p>

        <div className="scanner-actions">
          {!running ? (
            <button className="btn btn-primary" onClick={startScanner}>
              📷 Iniciar câmera
            </button>
          ) : (
            <button className="btn btn-outline" onClick={stopScanner}>
              ⏹ Parar
            </button>
          )}
        </div>
      </main>

      {feedback && (
        <FeedbackModal
          type={feedback.type}
          message={feedback.message}
          employeeName={feedback.employeeName}
          onDismiss={handleDismiss}
        />
      )}
    </>
  );
}
