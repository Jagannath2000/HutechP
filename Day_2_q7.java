package Hutech;

import java.util.Arrays;
import java.util.Scanner;

public class Day_2_q7 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println("Enter 1st string :");
        String s1 = sc.nextLine();
        System.out.println("Enter 2nd string : ");
        String s2 = sc.nextLine();

        if (isAnagram(s1,s2)) {
            System.out.println("Two Strings are anagram");
            
        }
        else{
            System.out.println("Not anagram");
        }
        
    }

    private static boolean isAnagram(String s1, String s2) {
        char []c1= s1.toCharArray();
        char []c2 = s2.toCharArray();


        if(s1.length() != s2.length())
        return false;

        Arrays.sort(c1);
        Arrays.sort(c2);

        for(int i=0;i<c1.length;i++){
            if(c1[i] != c2[i])
            return false;
        }


       

        return true;
     
    }
    
}
