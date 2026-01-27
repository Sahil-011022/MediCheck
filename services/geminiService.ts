
import { GoogleGenAI, Type } from "@google/genai";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

export interface Attachment {
  data: string; // base64
  mimeType: string;
}

export const analyzeSymptoms = async (symptoms: string, attachments: Attachment[] = []) => {
  const ai = getAI();
  
  const parts: any[] = [
    { text: `Analyze the following symptoms and provided clinical attachments (images or documents). 
    Provide a structured health assessment. IMPORTANT: This is for informational purposes only.
    
    Symptoms described by patient: ${symptoms}` }
  ];

  // Add attachments to the prompt
  attachments.forEach(attr => {
    parts.push({
      inlineData: {
        data: attr.data,
        mimeType: attr.mimeType
      }
    });
  });

  // Use gemini-3-pro-preview for complex text tasks (advanced reasoning)
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          analysis: {
            type: Type.STRING,
            description: "A detailed explanation of what the symptoms and attachments might indicate."
          },
          possibleConditions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "A list of potential medical conditions."
          },
          urgency: {
            type: Type.STRING,
            description: "Urgency level: Low, Medium, High, or Critical."
          },
          advice: {
            type: Type.STRING,
            description: "Immediate advice for the patient."
          }
        },
        required: ["analysis", "possibleConditions", "urgency", "advice"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const findNearbyPharmacies = async (lat?: number, lng?: number) => {
  const ai = getAI();
  const locationText = lat && lng ? `near latitude ${lat}, longitude ${lng}` : "nearby";
  
  // Using gemini-2.5-flash as it has better tool support for Maps grounding
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Find and list 5 open pharmacies ${locationText}. Please use Google Maps to find their exact locations and return them.`,
    config: {
      tools: [{ googleMaps: {} }],
      toolConfig: {
        retrievalConfig: lat && lng ? {
          latLng: {
            latitude: lat,
            longitude: lng
          }
        } : undefined
      }
    },
  });

  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  
  // Extracting data from grounding chunks safely
  const places = chunks
    .filter((chunk: any) => chunk.maps)
    .map((chunk: any) => ({
      title: chunk.maps.title || "Pharmacy",
      uri: chunk.maps.uri || "#"
    }));

  return {
    text: response.text,
    places: places.length > 0 ? places : []
  };
};
