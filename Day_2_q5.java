package Hutech;

import java.util.Scanner;

public class Day_2_q5 {
    // Write a Program to  Fibonacci Series Number
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println("Eneter how many number do you want : ");
        int n = sc.nextInt();

        findFibonacyNum(n);
        

    }

    private static void findFibonacyNum(int n) {
        int f1=0,f2=1;
        System.out.println("fibonacci series up to "+ n);
        for(int i=0;i<n;i++){
            System.out.println(f1+" ");
            int f3 = f1+f2;
            // System.out.println(f3+ " f3 value");
            f1=f2;
            // System.out.println(f1+ " f1 value");
            f2=f3;
            // System.out.println(f2+ " f2 value");
        }
 
            
        }
    }
    

