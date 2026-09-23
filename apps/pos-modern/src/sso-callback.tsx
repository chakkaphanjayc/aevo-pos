import { useEffect, useState } from 'react';
import { exchangeSso, PosApiError } from './api';

export function SsoCallback() {
  const [message, setMessage] = useState('กำลังยืนยันการเข้าสู่ระบบ…');

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');
      if (!code || !state) {
        setMessage('ลิงก์เข้าสู่ระบบไม่สมบูรณ์ กรุณาเริ่มจาก Aevo POS อีกครั้ง');
        return;
      }
      try {
        const result = await exchangeSso(code, state);
        const returnPath = result.returnPath.startsWith('/') && !result.returnPath.startsWith('//') ? result.returnPath : '/';
        if (!cancelled) window.location.replace(returnPath);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof PosApiError ? error.message : 'การยืนยัน session ไม่สำเร็จ');
      }
    };
    void run();
    return () => { cancelled = true; };
  }, []);

  return <main className="pos-state-screen"><div className="pos-state-card"><span className="pos-spinner" aria-hidden="true">◌</span><h1>กำลังเปิด Aevo POS</h1><p>{message}</p></div></main>;
}
