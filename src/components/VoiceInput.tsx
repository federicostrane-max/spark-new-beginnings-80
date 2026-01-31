import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface VoiceInputProps {
  onTranscription: (text: string) => void;
  disabled?: boolean;
}

export const VoiceInput = ({ onTranscription, disabled }: VoiceInputProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await transcribeAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsProcessing(true);
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    try {
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      
      reader.onloadend = async () => {
        try {
          const base64Audio = (reader.result as string).split(',')[1];

          const { data, error } = await supabase.functions.invoke('transcribe-audio', {
            body: { audio: base64Audio }
          });

          if (error) throw error;

          if (data?.text) {
            onTranscription(data.text);
            console.log("Trascrizione completata");
          }
        } catch (error) {
          console.error('Transcription error:', error);
        } finally {
          setIsProcessing(false);
        }
      };
      
      reader.onerror = () => {
        console.error('FileReader error');
        setIsProcessing(false);
      };
    } catch (error) {
      console.error('Transcription error:', error);
      setIsProcessing(false);
    }
  };

  return (
    <Button
      type="button"
      size="icon"
      variant={isRecording ? "destructive" : isProcessing ? "secondary" : "outline"}
      onClick={isRecording ? stopRecording : startRecording}
      disabled={disabled || isProcessing}
      className={`h-[50px] w-[50px] md:h-[60px] md:w-[60px] ${
        isProcessing ? 'cursor-wait' : ''
      }`}
      data-testid="voice-input-button"
      data-recording={isRecording}
      data-processing={isProcessing}
      aria-label={isRecording ? "Stop recording" : isProcessing ? "Processing audio" : "Start voice recording"}
    >
      {isRecording ? (
        <Square className="h-4 w-4 md:h-5 md:w-5 animate-pulse" />
      ) : isProcessing ? (
        <Loader2 className="h-4 w-4 md:h-5 md:w-5 animate-spin" />
      ) : (
        <Mic className="h-4 w-4 md:h-5 md:w-5" />
      )}
    </Button>
  );
};
