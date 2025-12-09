import React, { useState, useRef, useEffect } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { createSession } from "../utils/api";
import "./AvatarChat.css";

export default function AvatarChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceModeEnabled, setIsVoiceModeEnabled] = useState(false);
  const [voiceMode, setVoiceMode] = useState('push-to-talk'); // 'push-to-talk' or 'continuous'

  const videoRef = useRef();
  const audioRef = useRef();
  const roomRef = useRef(null);
  const messagesEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const localAudioTrackRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit'
    });
  };

  const startAvatar = async () => {
    try {
      setIsLoading(true);
      
      const res = await createSession();
      
      if (!res.livekitUrl || !res.livekitToken) {
        throw new Error("Missing LiveKit credentials");
      }

      const room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.Connected, () => {
        setIsConnected(true);
        setIsLoading(false);
      });

      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === Track.Kind.Video && videoRef.current) {
          const element = track.attach();
          videoRef.current.srcObject = element.srcObject;
        } else if (track.kind === Track.Kind.Audio && audioRef.current) {
          const element = track.attach();
          audioRef.current.srcObject = element.srcObject;
          audioRef.current.play().catch(() => {});
        }
      });

      // Register text stream handler for transcriptions
      room.registerTextStreamHandler('lk.transcription', async (reader, participantInfo) => {
        try {
          const message = await reader.readAll();
          const isFinal = reader.info.attributes['lk.transcription_final'] === 'true';
          const segmentId = reader.info.attributes['lk.segment_id'];
          
          if (isFinal && message.trim()) {
            setMessages(prev => [
              ...prev,
              { 
                sender: "Avatar", 
                text: message.trim(), 
                timestamp: new Date(),
                key: `${segmentId}-${Date.now()}` 
              }
            ]);
            setIsAvatarSpeaking(false);
          } else if (!isFinal) {
            setIsAvatarSpeaking(true);
          }
        } catch (e) {
          console.error("Error reading text stream:", e);
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        setIsConnected(false);
        stopVoiceMode();
        setMessages(prev => [
          ...prev,
          { 
            sender: "System", 
            text: "Disconnected from avatar. Please restart the conversation.", 
            timestamp: new Date(),
            key: Date.now() 
          }
        ]);
      });

      room.on(RoomEvent.Error, (error) => {
        setMessages(prev => [
          ...prev,
          { 
            sender: "System", 
            text: `Error: ${error.message}`, 
            timestamp: new Date(),
            key: Date.now() 
          }
        ]);
      });

      await room.connect(res.livekitUrl, res.livekitToken, {
        autoSubscribe: true,
      });

    } catch (error) {
      setIsLoading(false);
      alert(`Failed to start: ${error.message}`);
    }
  };

  // Enable continuous voice mode
  const enableVoiceMode = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });

      const audioTrack = stream.getAudioTracks()[0];
      
      // Publish audio track to LiveKit
      await roomRef.current.localParticipant.publishTrack(audioTrack, {
        source: Track.Source.Microphone,
        name: 'user-microphone'
      });

      localAudioTrackRef.current = audioTrack;
      setIsVoiceModeEnabled(true);

      setMessages(prev => [
        ...prev,
        { 
          sender: "System", 
          text: "🎤 Voice mode enabled. Speak naturally - Jane will respond!", 
          timestamp: new Date(),
          key: Date.now() 
        }
      ]);

    } catch (error) {
      console.error("Failed to enable voice mode:", error);
      alert("Failed to access microphone. Please check permissions.");
    }
  };

  // Disable continuous voice mode
  const stopVoiceMode = () => {
    if (localAudioTrackRef.current) {
      localAudioTrackRef.current.stop();
      localAudioTrackRef.current = null;
    }
    
    if (roomRef.current && roomRef.current.localParticipant) {
      const micTrack = roomRef.current.localParticipant.getTrackBySource(Track.Source.Microphone);
      if (micTrack) {
        roomRef.current.localParticipant.unpublishTrack(micTrack);
      }
    }

    setIsVoiceModeEnabled(false);
    
    setMessages(prev => [
      ...prev,
      { 
        sender: "System", 
        text: "🔇 Voice mode disabled.", 
        timestamp: new Date(),
        key: Date.now() 
      }
    ]);
  };

  // Start recording (push-to-talk)
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm'
      });

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        
        // Convert blob to base64 and send
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Audio = reader.result.split(',')[1];
          
          // Send audio to avatar
          await sendAudioMessage(base64Audio);
        };
        reader.readAsDataURL(audioBlob);

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      setMessages(prev => [
        ...prev,
        { 
          sender: "System", 
          text: "🎤 Recording... Release button when done", 
          timestamp: new Date(),
          key: Date.now() 
        }
      ]);

    } catch (error) {
      console.error("Failed to start recording:", error);
      alert("Failed to access microphone. Please check permissions.");
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setIsRecording(false);
    }
  };

  // Send audio message via text (for transcription by avatar)
  const sendAudioMessage = async (base64Audio) => {
    try {
      setIsLoading(true);

      // In FULL mode, we need to send text, so we'll need to transcribe first
      // For now, let's send a placeholder and let the avatar handle it
      await roomRef.current.localParticipant.sendText("[Voice message sent]", {
        topic: 'lk.chat',
      });

      setMessages(prev => [
        ...prev,
        { 
          sender: "You", 
          text: "🎤 [Voice message]", 
          timestamp: new Date(),
          key: `user-audio-${Date.now()}` 
        }
      ]);

      setIsLoading(false);
    } catch (error) {
      setIsLoading(false);
      console.error("Failed to send audio:", error);
    }
  };

  // Send text message
  const handleSend = async () => {
    if (!input.trim() || !roomRef.current || isLoading) return;

    const userMessage = input.trim();
    
    setMessages(prev => [
      ...prev, 
      { 
        sender: "You", 
        text: userMessage, 
        timestamp: new Date(),
        key: `user-${Date.now()}` 
      }
    ]);
    
    setInput("");
    setIsLoading(true);

    try {
      await roomRef.current.localParticipant.sendText(userMessage, {
        topic: 'lk.chat',
      });
      
      setIsLoading(false);
    } catch (error) {
      setIsLoading(false);
      setMessages(prev => [
        ...prev,
        { 
          sender: "System", 
          text: "Failed to send message. Please try again.", 
          timestamp: new Date(),
          key: `error-${Date.now()}` 
        }
      ]);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const disconnect = () => {
    if (roomRef.current) {
      stopVoiceMode();
      roomRef.current.disconnect();
      roomRef.current = null;
      setIsConnected(false);
    }
  };

  useEffect(() => {
    return () => {
      stopVoiceMode();
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
    };
  }, []);

  return (
    <div className="avatar-chat-container">
      <header className="chat-header">
        <h1>Water cooler Chat with Jane</h1>
        <p className="subtitle">Your friendly virtual colleague</p>
      </header>
      
      {!isConnected && (
        <div className="start-section">
          <button 
            className="start-button" 
            onClick={startAvatar} 
            disabled={isLoading}
          >
            {isLoading ? "Connecting..." : "Start Conversation"}
          </button>
        </div>
      )}

      <div className="video-container">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="avatar-video"
        />
        <audio
          ref={audioRef}
          autoPlay
          className="avatar-audio"
        />
      </div>

      {isConnected && (
        <div className="chat-section">
          {/* Voice Mode Toggle */}
          <div className="voice-controls">
            <button
              onClick={isVoiceModeEnabled ? stopVoiceMode : enableVoiceMode}
              className={`voice-mode-button ${isVoiceModeEnabled ? 'active' : ''}`}
            >
              {isVoiceModeEnabled ? '🔊 Voice Mode ON' : '🎤 Enable Voice Mode'}
            </button>
            {isVoiceModeEnabled && (
              <span className="voice-indicator">Listening...</span>
            )}
          </div>

          <div className="messages-window">
            {messages.map((msg) => (
              <div 
                key={msg.key}
                className={`message-container ${msg.sender.toLowerCase()}`}
              >
                <div className="message-bubble">
                  <div className="message-text">{msg.text}</div>
                  <div className="message-time">{formatTime(msg.timestamp)}</div>
                </div>
              </div>
            ))}
            {(isLoading || isAvatarSpeaking) && (
              <div className="message-container avatar">
                <div className="message-bubble">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-section">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message..."
              className="chat-input"
              disabled={isLoading || isVoiceModeEnabled}
            />
            
            {/* Push-to-Talk Button */}
            <button
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onTouchStart={startRecording}
              onTouchEnd={stopRecording}
              className={`record-button ${isRecording ? 'recording' : ''}`}
              disabled={isVoiceModeEnabled}
              title="Hold to record"
            >
              {isRecording ? '🔴' : '🎤'}
            </button>

            <button
              onClick={handleSend}
              className="send-button"
              disabled={!input.trim() || isLoading || isVoiceModeEnabled}
            >
              Send
            </button>
            <button
              onClick={disconnect}
              className="end-button"
            >
              End
            </button>
          </div>
        </div>
      )}
    </div>
  );
}