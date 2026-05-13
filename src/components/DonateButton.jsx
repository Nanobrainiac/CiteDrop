import { Heart } from 'lucide-react';

const donateUrl = 'https://donate.stripe.com/7sY6oH1Uv0Ih3IYaWZ7Zu00';

export default function DonateButton({ className = '', compact = false }) {
  return (
    <a
      href={donateUrl}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-acid px-5 py-3 font-black text-ink hover:bg-white ${className}`}
    >
      <Heart size={18} />
      <span className="flex flex-col items-start leading-none">
        <span className="text-sm font-black uppercase">DONATE</span>
        {!compact ? <span className="mt-1 text-xs font-bold normal-case opacity-75">to keep CiteDrop free</span> : null}
      </span>
    </a>
  );
}
