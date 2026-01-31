import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface AttachmentUploadProps {
  onAttachmentAdded: (fileUrl: string, fileName: string, fileType: string) => void;
  disabled?: boolean;
}

export const AttachmentUpload = ({ onAttachmentAdded, disabled }: AttachmentUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type (images and PDFs only)
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      console.warn("Tipo file non valido, sono supportati solo immagini (JPEG, PNG, WEBP) o PDF");
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      console.warn("File troppo grande, il limite è 10MB");
      return;
    }

    setUploading(true);

    try {
      // Upload to storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('agent-attachments')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('agent-attachments')
        .getPublicUrl(filePath);

      // Set preview for images
      if (file.type.startsWith('image/')) {
        setPreview(publicUrl);
      }

      onAttachmentAdded(publicUrl, file.name, file.type);

      console.log(`File caricato: ${file.name}`);
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setUploading(false);
    }
  };

  const clearPreview = () => {
    setPreview(null);
  };

  return (
    <div className="flex items-center gap-2">
      {preview && (
        <div className="relative">
          <img src={preview} alt="Preview" className="h-12 w-12 rounded object-cover" />
          <Button
            type="button"
            size="icon"
            variant="destructive"
            className="absolute -right-2 -top-2 h-5 w-5"
            onClick={clearPreview}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
      
      <Button
        type="button"
        size="icon"
        variant="outline"
        disabled={disabled || uploading}
        className="h-[50px] w-[50px] md:h-[60px] md:w-[60px] relative"
        data-testid="attachment-upload-button"
        data-uploading={uploading}
        aria-label="Upload attachment"
      >
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={handleFileSelect}
          disabled={disabled || uploading}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
        <Paperclip className="h-4 w-4 md:h-5 md:w-5" />
      </Button>
    </div>
  );
};
